import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { registerDevice } from '../server/identity';
import { signIn, signUp } from '../server/accounts';
import { FLAG_DAYS, MAX_DEVICES, PER_MINUTE, flaggedThisMonth, forgetSpeed, noteCeiling, withinSpeed } from '../server/fairUse';

/**
 * Fair use on an unlimited Plus: what stops a program, a household on one
 * account, and somebody who is always at the ceiling — and what never stops
 * a person eating and logging.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

before(async () => {
  if (enabled) await migrate();
});
after(async () => {
  if (enabled) await closeDatabase();
});

test('a person is never too fast; a program is, within the minute, and only for that minute', () => {
  forgetSpeed();
  const start = 1_000_000;
  for (let i = 0; i < PER_MINUTE.photo; i++) assert.ok(withinSpeed('sam', 'photo', start + i * 1000), `analysis ${i + 1} in a minute`);
  assert.equal(withinSpeed('sam', 'photo', start + 15_000), false, 'one more than ten in a minute is a program');
  assert.ok(withinSpeed('sam', 'chat', start + 15_000), 'questions have their own limit');
  assert.ok(withinSpeed('alex', 'photo', start + 15_000), 'and somebody else theirs');
  assert.ok(withinSpeed('sam', 'photo', start + 61_000), 'a minute on, the first has aged out');
  assert.deepEqual(PER_MINUTE, { photo: 10, chat: 15, recipe: 5 });
});

when('a sixth device signing in signs out the one used longest ago, never the one signing in', async () => {
  const first = await registerDevice();
  const email = `fair-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const made = await signUp(first.id, email, 'four random words');
  assert.ok(made.ok);
  const devices = [first.id];
  for (let i = 1; i < MAX_DEVICES; i++) {
    const next = await registerDevice();
    assert.ok((await signIn(next.id, email, 'four random words')).ok);
    devices.push(next.id);
  }
  // The first is the one not used for longest.
  await query("update devices set last_seen_at = now() - interval '10 days' where id = $1", [first.id]);
  await query("update devices set last_seen_at = now() - interval '1 day' where id = any($1) and id <> $2", [devices, first.id]);

  const sixth = await registerDevice();
  assert.ok((await signIn(sixth.id, email, 'four random words')).ok);
  const signedIn = (await query<{ id: string }>('select id from devices where account_id = $1', [made.ok ? made.account.id : ''])).map((row) => row.id);
  assert.equal(signedIn.length, MAX_DEVICES);
  assert.ok(signedIn.includes(sixth.id), 'the new phone is in');
  assert.ok(!signedIn.includes(first.id), 'the old one is out');
  const out = await query<{ account_id: string | null }>('select account_id from devices where id = $1', [first.id]);
  assert.equal(out[0].account_id, null, 'signed out, not deleted: it still works on its own');
});

when('reaching a ceiling is noted once a day, and three days in a month puts somebody on the dashboard', async () => {
  const owner = `owner-${Math.random().toString(36).slice(2)}`;
  await noteCeiling(owner, 'photo');
  await noteCeiling(owner, 'photo');
  await noteCeiling(owner, 'chat-speed');
  assert.equal((await query('select 1 from fair_use_hits where owner_id = $1', [owner])).length, 2, 'once a day a kind');
  assert.ok(!(await flaggedThisMonth()).has(owner), 'one day is a busy day, not a pattern');

  // Three different days this month: the first three of it.
  await query('delete from fair_use_hits where owner_id = $1', [owner]);
  await query(
    `insert into fair_use_hits (owner_id, day, kind)
     select $1, date_trunc('month', current_date)::date + n, 'photo' from generate_series(0, $2 - 1) as n`,
    [owner, FLAG_DAYS],
  );
  assert.equal((await flaggedThisMonth()).get(owner), FLAG_DAYS);
  assert.equal(FLAG_DAYS, 3);
});

when('the dashboard shows who is over fair use, and can list only them', async () => {
  const { people } = await import('../server/admin');
  const device = await registerDevice();
  const email = `flagged-${Date.now()}@example.com`;
  const made = await signUp(device.id, email, 'four random words');
  assert.ok(made.ok);
  const id = made.ok ? made.account.id : '';
  let found = (await people(email))[0];
  assert.equal(found.overFairUse, false);
  assert.equal(found.fairUseDays, 0);
  await query(
    `insert into fair_use_hits (owner_id, day, kind)
     select $1, date_trunc('month', current_date)::date + n, 'chat' from generate_series(0, 2) as n`,
    [id],
  );
  found = (await people(email))[0];
  assert.deepEqual([found.fairUseDays, found.overFairUse], [3, true]);
  assert.ok((await people('', 500, true)).some((person) => person.id === id), 'in the list of those over');
  assert.ok(!(await people('', 500, true)).some((person) => !person.overFairUse), 'and nobody who is not');
});
