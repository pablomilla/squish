import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { registerDevice, spend } from '../server/identity';
import { signUp } from '../server/accounts';
import { ALLOWANCE, PERIOD, allowanceFor, isBillable, needsAccount, nextReset, planFor, standingOf, usedFor, usedThisMonth } from '../server/plan';

/**
 * Tiers, against a real Postgres.
 *
 * The rules worth protecting here are the ones with money attached: nobody
 * gets Plus without an account saying so, a lapsed subscription stops being
 * true without anything having to run, and an allowance belongs to a person
 * rather than to each device they happen to own.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

let n = 0;
const anEmail = () => `plan${++n}-${Date.now()}@example.com`;

before(async () => {
  if (!enabled) return;
  await migrate();
});

after(async () => {
  if (enabled) await closeDatabase();
});

async function anAccount(plusDays: number | null) {
  const device = await registerDevice();
  const email = anEmail();
  const made = await signUp(device.id, email, 'four random words');
  const id = made.ok ? made.account.id : '';
  if (plusDays !== null) {
    await query(`update accounts set plus_until = now() + ($2 || ' days')::interval where id = $1`, [id, String(plusDays)]);
  }
  return { device: { id: device.id, accountId: id }, email, id };
}

/* ---------------- who is on what ---------------- */

when('a device with no account is on the free plan', async () => {
  const device = await registerDevice();
  assert.equal(await planFor({ id: device.id, accountId: null }), 'free');
});

when('an account is free until something says otherwise', async () => {
  const { device } = await anAccount(null);
  assert.equal(await planFor(device), 'free');
});

when('a granted account is on Plus', async () => {
  const { device } = await anAccount(30);
  assert.equal(await planFor(device), 'plus');
});

when('a subscription that has run out is free again, with nothing having to run', async () => {
  // The reason the column is a date and not a boolean. Nothing sweeps, nothing
  // expires anything on a schedule — it simply stops being true.
  const { device } = await anAccount(-1);
  assert.equal(await planFor(device), 'free');
});

/* ---------------- what that entitles them to ---------------- */

when('the free plan gets a taste of the analysis and the nutritionist, and nothing else that costs money', async () => {
  // Straight from docs/monetisation.md: everything cheap to serve is free, and
  // of the AI, only enough to find out whether it is any good.
  assert.equal(ALLOWANCE.free.photo, 5, 'somebody has to be able to try the analysis');
  assert.equal(ALLOWANCE.free.chat, 3, 'and the nutritionist, which is what Plus is sold on');
  assert.ok(ALLOWANCE.plus.chat > ALLOWANCE.free.chat);
  assert.equal(ALLOWANCE.free.recipe, 0);
  assert.ok(ALLOWANCE.plus.photo > ALLOWANCE.free.photo);
  assert.ok(ALLOWANCE.plus.chat > 0);
});

when('the free taste is once, and Plus is by the month', async () => {
  // A monthly free allowance is a bill that grows with every free user who
  // never pays. A taste costs once per person.
  assert.equal(PERIOD.free, 'ever');
  assert.equal(PERIOD.plus, 'month');
});

when('the taste needs an account; a signed-out browser is told so, not given it', async () => {
  const device = await registerDevice();
  const me = { id: device.id, accountId: null };
  assert.deepEqual(allowanceFor(me, 'free'), { photo: 0, chat: 0, recipe: 0 });
  assert.equal(needsAccount(me, 'free'), true);

  const standing = await standingOf(me);
  assert.equal(standing.needsAccount, true);
  assert.equal(standing.left.photo, 0);

  const { device: signedIn } = await anAccount(null);
  assert.equal(needsAccount(signedIn, 'free'), false);
  assert.equal((await standingOf(signedIn)).left.photo, ALLOWANCE.free.photo);
});

when('the taste does not come back next month', async () => {
  const { device } = await anAccount(null);
  for (let i = 0; i < ALLOWANCE.free.photo; i++) await spend(device.id, 'photo');
  // Move all of it into last month: a monthly count would forget it, the taste must not.
  await query("update usage set day = (date_trunc('month', current_date) - interval '1 day')::date where device_id = $1", [device.id]);

  assert.equal(await usedThisMonth(device, 'photo'), 0, 'a monthly count forgets it');
  assert.equal(await usedFor(device, 'photo', 'free'), ALLOWANCE.free.photo, 'the taste does not');
  assert.equal((await standingOf(device)).left.photo, 0);
});

when('a second account in the same browser does not get a second taste', async () => {
  const { device } = await anAccount(null);
  for (let i = 0; i < ALLOWANCE.free.photo; i++) await spend(device.id, 'photo');

  // The same browser, now signed into a brand-new account.
  const other = await signUp(device.id, anEmail(), 'four random words');
  assert.ok(other.ok);
  const again = { id: device.id, accountId: other.account.id };
  assert.equal((await standingOf(again)).left.photo, 0);
});

when('a subscriber who lapses to free has already had their taste', async () => {
  const { device, id } = await anAccount(30);
  for (let i = 0; i < 20; i++) await spend(device.id, 'photo');
  await query("update accounts set plus_until = now() - interval '1 day' where id = $1", [id]);
  const standing = await standingOf(device);
  assert.equal(standing.plan, 'free');
  assert.equal(standing.left.photo, 0);
});

when('Plus has an allowance too', async () => {
  // Not meanness. A heavy user costs more per month than Plus charges, so
  // without a ceiling the best customers lose the most money.
  for (const kind of ['photo', 'chat', 'recipe'] as const) {
    assert.ok(ALLOWANCE.plus[kind] > 0 && Number.isFinite(ALLOWANCE.plus[kind]), `${kind} must have a ceiling`);
  }
});

when('signing in and resetting are not billable, so a tier cannot change them', async () => {
  assert.equal(isBillable('photo'), true);
  assert.equal(isBillable('chat'), true);
  assert.equal(isBillable('recipe'), true);
  assert.equal(isBillable('signin'), false);
  assert.equal(isBillable('reset'), false);
});

/* ---------------- counting ---------------- */

when('the allowance belongs to the person, not to each device they own', async () => {
  // Otherwise a phone and a laptop is two allowances, and the way to get more
  // is to open the app somewhere else.
  const { device, id } = await anAccount(30);
  const second = await registerDevice();
  await query('update devices set account_id = $1 where id = $2', [id, second.id]);

  await spend(device.id, 'photo');
  await spend(device.id, 'photo');
  await spend(second.id, 'photo');

  assert.equal(await usedThisMonth(device, 'photo'), 3, 'the second device was counted separately');
  assert.equal(await usedThisMonth({ id: second.id, accountId: id }, 'photo'), 3, 'both devices should see one total');
});

when('an anonymous device is counted on its own', async () => {
  const device = await registerDevice();
  const me = { id: device.id, accountId: null };
  await spend(device.id, 'photo');
  assert.equal(await usedThisMonth(me, 'photo'), 1);

  const stranger = await registerDevice();
  await spend(stranger.id, 'photo');
  assert.equal(await usedThisMonth(me, 'photo'), 1, 'somebody else spent this device allowance');
});

when('what is left is the allowance minus what has gone, and never below nought', async () => {
  const { device } = await anAccount(null);
  const standing = await standingOf(device);
  assert.equal(standing.plan, 'free');
  assert.equal(standing.left.photo, ALLOWANCE.free.photo);

  for (let i = 0; i < ALLOWANCE.free.photo + 3; i++) await spend(device.id, 'photo');
  const after = await standingOf(device);
  assert.equal(after.left.photo, 0, 'it should floor at nought rather than going negative');
  assert.ok(after.used.photo > ALLOWANCE.free.photo);
});

when('the allowance comes back on the first of next month', async () => {
  const reset = new Date(nextReset(new Date('2026-09-22T12:00:00Z')));
  assert.equal(reset.toISOString(), '2026-10-01T00:00:00.000Z');
  // December has to roll the year, which is the one this gets wrong.
  assert.equal(new Date(nextReset(new Date('2026-12-15T12:00:00Z'))).toISOString(), '2027-01-01T00:00:00.000Z');
});
