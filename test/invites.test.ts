import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { registerDevice } from '../server/identity';
import { signUp } from '../server/accounts';
import { planFor } from '../server/plan';
import { inviteCodes, inviteDays, invitesExist, redeem, redemptions } from '../server/invites';

/**
 * Invite codes, against a real Postgres.
 *
 * The codes are an environment variable rather than a table so that giving a
 * tester Plus is editing a field in a dashboard, not opening a shell against
 * the production database. What that buys in convenience it has to pay for in
 * care: a code is worth a year of a paid tier to whoever holds one, so the
 * rules about what counts as one, and what happens when the same person tries
 * twice, are the part worth testing.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

let n = 0;
const anEmail = () => `invite${++n}-${Date.now()}@example.com`;

before(async () => {
  if (!enabled) return;
  await migrate();
});

after(async () => {
  if (enabled) await closeDatabase();
  delete process.env.SQUISH_INVITE_CODES;
  delete process.env.SQUISH_INVITE_DAYS;
});

async function anAccount() {
  const device = await registerDevice();
  const made = await signUp(device.id, anEmail(), 'four random words');
  const id = made.ok ? made.account.id : '';
  return { id, device: { id: device.id, accountId: id } };
}

/* ---------------- what counts as a code ---------------- */

test('with nothing set there are no codes, which is the right default', () => {
  delete process.env.SQUISH_INVITE_CODES;
  assert.deepEqual(inviteCodes(), []);
  assert.equal(invitesExist(), false, 'a Squish given no codes must not have a back door');
});

test('codes are read as a list, and compared the way a person types them', () => {
  process.env.SQUISH_INVITE_CODES = ' early-bird , PRESS-2026 ,, ';
  assert.deepEqual(inviteCodes(), ['EARLY-BIRD', 'PRESS-2026'], 'case and stray commas should not matter');
  assert.equal(invitesExist(), true);
});

test('a year unless somebody says otherwise, and nonsense does not become nought', () => {
  delete process.env.SQUISH_INVITE_DAYS;
  assert.equal(inviteDays(), 365);
  process.env.SQUISH_INVITE_DAYS = '30';
  assert.equal(inviteDays(), 30);
  process.env.SQUISH_INVITE_DAYS = 'soon';
  assert.equal(inviteDays(), 365, 'an unreadable value must not silently mean a zero-day grant');
  process.env.SQUISH_INVITE_DAYS = '-5';
  assert.equal(inviteDays(), 365);
});

/* ---------------- redeeming ---------------- */

when('a good code turns Plus on', async () => {
  process.env.SQUISH_INVITE_CODES = 'TESTERS-2026';
  process.env.SQUISH_INVITE_DAYS = '30';
  const { id, device } = await anAccount();
  assert.equal(await planFor(device), 'free');

  const done = await redeem(id, 'testers-2026');
  assert.equal(done.ok, true, 'a code typed in lower case should still work');
  assert.equal(done.ok && done.days, 30);
  assert.equal(await planFor(device), 'plus');
});

when('a code nobody issued does nothing', async () => {
  process.env.SQUISH_INVITE_CODES = 'TESTERS-2026';
  const { id, device } = await anAccount();
  const done = await redeem(id, 'PLEASE-LET-ME-IN');
  assert.equal(done.ok, false);
  assert.equal(!done.ok && done.reason, 'unknown');
  assert.equal(await planFor(device), 'free');
});

when('the same account cannot use one code twice', async () => {
  process.env.SQUISH_INVITE_CODES = 'TESTERS-2026';
  process.env.SQUISH_INVITE_DAYS = '30';
  const { id } = await anAccount();
  assert.equal((await redeem(id, 'TESTERS-2026')).ok, true);

  const again = await redeem(id, 'TESTERS-2026');
  assert.equal(again.ok, false, 'a second go bought another month');
  assert.equal(!again.ok && again.reason, 'already');
});

when('two taps on a slow connection do not buy two years', async () => {
  process.env.SQUISH_INVITE_CODES = 'TESTERS-2026';
  process.env.SQUISH_INVITE_DAYS = '30';
  const { id } = await anAccount();

  const [a, b] = await Promise.all([redeem(id, 'TESTERS-2026'), redeem(id, 'TESTERS-2026')]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1, 'both redemptions went through');

  const rows = await query<{ n: string }>('select count(*) as n from invite_uses where account_id = $1', [id]);
  assert.equal(Number(rows[0].n), 1);
});

when('a code extends somebody rather than cutting them short', async () => {
  // Given to somebody already on Plus, it has to add to what they have. The
  // alternative — replacing it — would take time off a paying subscriber for
  // the crime of accepting a gift.
  process.env.SQUISH_INVITE_CODES = 'TESTERS-2026';
  process.env.SQUISH_INVITE_DAYS = '30';
  const { id } = await anAccount();
  await query(`update accounts set plus_until = now() + interval '300 days' where id = $1`, [id]);

  const done = await redeem(id, 'TESTERS-2026');
  assert.equal(done.ok, true);
  const rows = await query<{ days: number }>(
    'select extract(day from plus_until - now())::int as days from accounts where id = $1',
    [id],
  );
  assert.ok(rows[0].days > 320, `expected roughly 330 days, got ${rows[0].days}`);
});

when('a lapsed account starts from today, not from when it ran out', async () => {
  process.env.SQUISH_INVITE_CODES = 'TESTERS-2026';
  process.env.SQUISH_INVITE_DAYS = '30';
  const { id, device } = await anAccount();
  await query(`update accounts set plus_until = now() - interval '200 days' where id = $1`, [id]);

  await redeem(id, 'TESTERS-2026');
  assert.equal(await planFor(device), 'plus', 'the grant was swallowed by the time already lapsed');
});

when('who used what is recorded, so uptake can be seen', async () => {
  process.env.SQUISH_INVITE_CODES = 'PRESS-2026';
  const { id } = await anAccount();
  await redeem(id, 'PRESS-2026');

  const used = await redemptions();
  assert.ok(used.some((row) => row.code === 'PRESS-2026'), 'the redemption was not recorded');
});
