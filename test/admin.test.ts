import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { registerDevice, recordCost, spend } from '../server/identity';
import { signUp } from '../server/accounts';
import { adminsExist, isAdmin, overview, people, setPlan } from '../server/admin';
import { planFor } from '../server/plan';

/**
 * The dashboard.
 *
 * Most of what is tested here is the boundary rather than the numbers: who
 * counts as an admin, and what an admin is allowed to reach. Getting a total
 * wrong is an embarrassment; getting the boundary wrong hands somebody else's
 * account, and the means to give away a paid tier, to whoever asks.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

let n = 0;
const anEmail = () => `admin${++n}-${Date.now()}@example.com`;

before(async () => {
  if (!enabled) return;
  await migrate();
});

after(async () => {
  if (enabled) await closeDatabase();
  delete process.env.SQUISH_ADMIN_EMAILS;
});

async function anAccount(email = anEmail()) {
  const device = await registerDevice();
  const made = await signUp(device.id, email, 'four random words');
  const id = made.ok ? made.account.id : '';
  return { id, email, deviceId: device.id, device: { id: device.id, accountId: id } };
}

/* ---------------- the boundary ---------------- */

test('with nobody listed, nobody is an admin', async () => {
  delete process.env.SQUISH_ADMIN_EMAILS;
  assert.equal(adminsExist(), false, 'an unconfigured Squish must not have a dashboard');
});

when('a device with no account is never an admin', async () => {
  process.env.SQUISH_ADMIN_EMAILS = 'boss@example.com';
  const device = await registerDevice();
  assert.equal(await isAdmin({ id: device.id, accountId: null }), false);
  assert.equal(await isAdmin(undefined), false);
});

when('an ordinary account is not an admin', async () => {
  const { device, email } = await anAccount();
  process.env.SQUISH_ADMIN_EMAILS = 'boss@example.com';
  assert.equal(await isAdmin(device), false, `${email} got in`);
});

when('a listed account is, however it was capitalised', async () => {
  const { device, email } = await anAccount();
  process.env.SQUISH_ADMIN_EMAILS = ` Someone@Else.com , ${email.toUpperCase()} `;
  assert.equal(await isAdmin(device), true);
});

when('taking somebody off the list takes the dashboard with it', async () => {
  // The list is the only thing that grants this, so emptying it has to be
  // enough — there must be nothing else to undo.
  const { device, email } = await anAccount();
  process.env.SQUISH_ADMIN_EMAILS = email;
  assert.equal(await isAdmin(device), true);
  process.env.SQUISH_ADMIN_EMAILS = '';
  assert.equal(await isAdmin(device), false);
});

/* ---------------- what it can do ---------------- */

when('an admin can put somebody on Plus and take them off again', async () => {
  const target = await anAccount();
  assert.equal(await planFor(target.device), 'free');

  const on = await setPlan('boss@example.com', target.email, 30);
  assert.equal(on.ok, true);
  assert.equal(await planFor(target.device), 'plus');

  const off = await setPlan('boss@example.com', target.email, 0);
  assert.equal(off.ok, true);
  assert.equal(await planFor(target.device), 'free');
});

when('granting somebody who does not exist says so rather than inventing them', async () => {
  const done = await setPlan('boss@example.com', 'nobody-here@example.com', 30);
  assert.equal(done.ok, false);
  assert.equal(!done.ok && done.reason, 'no_account');
});

when('every grant is written down, with who did it', async () => {
  // Giving away a paid tier is the sort of thing that gets disputed later.
  const target = await anAccount();
  await setPlan('boss@example.com', target.email, 30);

  const rows = await query<{ admin: string; action: string; detail: string }>(
    'select admin, action, detail from admin_actions where subject = $1 order by at desc limit 1',
    [target.email],
  );
  assert.equal(rows[0]?.admin, 'boss@example.com');
  assert.equal(rows[0]?.action, 'grant');
  assert.equal(rows[0]?.detail, '30 days');
});

when('a grant extends rather than replacing', async () => {
  const target = await anAccount();
  await setPlan('boss@example.com', target.email, 300);
  await setPlan('boss@example.com', target.email, 30);

  const rows = await query<{ days: number }>(
    'select extract(day from plus_until - now())::int as days from accounts where id = $1',
    [target.id],
  );
  assert.ok(rows[0].days > 320, `expected roughly 330 days, got ${rows[0].days}`);
});

/* ---------------- what it reports ---------------- */

when('spend is what was charged, not counts times a guess', async () => {
  const { deviceId } = await anAccount();
  await spend(deviceId, 'photo');
  await recordCost(deviceId, 'photo', 0.0412);

  const rows = await query<{ usd: string }>(
    `select cost_usd::text as usd from usage where device_id = $1 and kind = 'photo' and day = current_date`,
    [deviceId],
  );
  assert.equal(Number(rows[0].usd), 0.0412, 'the real price was not kept');

  const head = await overview();
  assert.ok(head.totalUsd > 0);
  assert.ok(head.accounts > 0 && head.devices > 0);
});

when('a call with no price recorded does not become a zero that looks measured', async () => {
  const { deviceId } = await anAccount();
  await spend(deviceId, 'chat');
  await recordCost(deviceId, 'chat', null);
  await recordCost(deviceId, 'chat', 0);

  const rows = await query<{ usd: string }>(
    `select cost_usd::text as usd from usage where device_id = $1 and kind = 'chat' and day = current_date`,
    [deviceId],
  );
  assert.equal(Number(rows[0].usd), 0, 'an unpriced call must not invent a number');
});

when('a person carries their own usage and nobody else\'s', async () => {
  const mine = await anAccount();
  const theirs = await anAccount();
  await spend(mine.deviceId, 'photo');
  await recordCost(mine.deviceId, 'photo', 0.05);
  await spend(theirs.deviceId, 'photo');
  await recordCost(theirs.deviceId, 'photo', 0.09);

  const found = await people(mine.email);
  assert.equal(found.length, 1, 'the search returned somebody else too');
  assert.equal(found[0].email, mine.email);
  assert.equal(found[0].used.photo, 1);
  assert.ok(Math.abs(found[0].usd - 0.05) < 0.0001, `got ${found[0].usd}`);
});

when('the dashboard cannot reach a diary', async () => {
  // Not an accident of the queries — a rule. Running the service means
  // knowing somebody used eleven analyses, not reading their lunch.
  const source = await import('node:fs').then((fs) => fs.readFileSync('server/admin.ts', 'utf8'));
  assert.ok(!/\bfrom diaries\b/.test(source), 'admin.ts reads the diaries table');
  assert.ok(!/\bstate\b/.test(source.replace(/\*[\s\S]*?\*\//g, '')), 'admin.ts touches diary state');
});
