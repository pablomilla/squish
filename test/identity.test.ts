import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { deviceFor, registerDevice, spend, spentToday } from '../server/identity';

/**
 * Device identity, against a real Postgres.
 *
 * Skipped where there is no DATABASE_URL, which is the same condition the app
 * itself checks — the point of these is the behaviour when a database exists,
 * and the behaviour when one does not is that nothing here is ever called.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

before(async () => {
  if (!enabled) return;
  await migrate();
  await query('truncate usage, diaries, devices, accounts cascade');
});

after(async () => {
  if (enabled) await closeDatabase();
});

when('a device is registered with a token that opens it again', async () => {
  const made = await registerDevice();
  assert.match(made.id, /^[\w-]{12}$/);
  assert.ok(made.token.length >= 40, 'a token short enough to guess is not a token');

  const found = await deviceFor(made.token);
  assert.equal(found?.id, made.id);
  assert.equal(found?.accountId, null, 'a device belongs to nobody until somebody signs up');
});

when('the token is not stored, only a hash of it', async () => {
  const made = await registerDevice();
  const rows = await query<{ token_hash: string }>('select token_hash from devices where id = $1', [made.id]);
  assert.notEqual(rows[0].token_hash, made.token, 'the token itself is in the database');
  assert.ok(!rows[0].token_hash.includes(made.token.slice(0, 16)), 'and neither is any of it');
});

when('an unknown token is nobody, and says so the same way every time', async () => {
  // A token that was never real, one from a database since replaced, and one
  // whose device was deleted all get the same answer, because the client does
  // the same thing about all three: register again.
  assert.equal(await deviceFor('never-was-a-token'), null);
  assert.equal(await deviceFor(''), null);
  assert.equal(await deviceFor(undefined), null);
});

when('two devices are separate, and one cannot be reached with the other’s token', async () => {
  const mine = await registerDevice();
  const yours = await registerDevice();
  assert.notEqual(mine.id, yours.id);
  assert.notEqual(mine.token, yours.token);
  assert.equal((await deviceFor(mine.token))?.id, mine.id);
  assert.equal((await deviceFor(yours.token))?.id, yours.id);
});

when('spending counts up, per kind, per device', async () => {
  const a = await registerDevice();
  const b = await registerDevice();

  assert.equal(await spend(a.id, 'photo'), 1);
  assert.equal(await spend(a.id, 'photo'), 2);
  assert.equal(await spend(a.id, 'chat'), 1, 'a different kind has its own count');
  assert.equal(await spend(b.id, 'photo'), 1, 'and so does a different device');

  assert.equal(await spentToday(a.id, 'photo'), 2);
  assert.equal(await spentToday(a.id, 'recipe'), 0, 'nothing spent is nought, not an error');
});

when('two calls at the same instant both count', async () => {
  // The read-then-write version loses one of these: both read four, both
  // write five, and somebody gets a free photo every time they double-tap.
  const device = await registerDevice();
  const results = await Promise.all(Array.from({ length: 12 }, () => spend(device.id, 'photo')));

  assert.equal(await spentToday(device.id, 'photo'), 12, 'a count was lost to a race');
  assert.deepEqual([...results].sort((x, y) => x - y), Array.from({ length: 12 }, (_, i) => i + 1));
});
