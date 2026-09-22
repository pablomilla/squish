import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { deviceFor, registerDevice, spend, spentToday } from '../server/identity';
import { deleteDiary, ownerOf, readDiary, writeDiary } from '../server/diary';

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

/* ---------------- The backup ---------------- */

when('a diary is kept and comes back as it went in', async () => {
  const device = await registerDevice();
  const owner = ownerOf({ id: device.id, accountId: null });
  const diary = { meals: [{ id: 'a', title: 'Katsu curry' }], profile: { name: 'Mia' } };

  assert.equal(await readDiary(owner), null, 'nothing kept for a device that has kept nothing');

  const first = await writeDiary(owner, diary, null);
  assert.deepEqual(first, { ok: true, version: 1, updatedAt: first.ok ? first.updatedAt : '' });

  const back = await readDiary(owner);
  assert.deepEqual(back?.state, diary);
  assert.equal(back?.version, 1);
});

when('a second write has to say which version it saw', async () => {
  const device = await registerDevice();
  const owner = ownerOf({ id: device.id, accountId: null });
  await writeDiary(owner, { meals: [] }, null);

  const second = await writeDiary(owner, { meals: ['one'] }, 1);
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.version, 2);
});

when('two phones at once: the second is refused and shown the first', async () => {
  // Without this, whichever closed last silently erased the other's afternoon.
  const device = await registerDevice();
  const owner = ownerOf({ id: device.id, accountId: null });
  await writeDiary(owner, { meals: ['breakfast'] }, null);

  const phone = await writeDiary(owner, { meals: ['breakfast', 'lunch'] }, 1);
  assert.equal(phone.ok, true);

  const laptop = await writeDiary(owner, { meals: ['breakfast', 'dinner'] }, 1);
  assert.equal(laptop.ok, false, 'the stale write went through and ate the lunch');
  assert.equal(!laptop.ok && laptop.reason, 'stale');
  assert.deepEqual(!laptop.ok && laptop.current.state, { meals: ['breakfast', 'lunch'] }, 'and it should be handed what it is up against');
  assert.equal(!laptop.ok && laptop.current.version, 2);
});

when('two first-writes race and only one wins', async () => {
  const device = await registerDevice();
  const owner = ownerOf({ id: device.id, accountId: null });

  const [a, b] = await Promise.all([
    writeDiary(owner, { from: 'a' }, null),
    writeDiary(owner, { from: 'b' }, null),
  ]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1, 'both first writes succeeded, so one diary was lost');
  const kept = await readDiary(owner);
  assert.equal(kept?.version, 1);
});

when('a diary too big to be real is refused rather than stored', async () => {
  const device = await registerDevice();
  const owner = ownerOf({ id: device.id, accountId: null });
  await assert.rejects(() => writeDiary(owner, { padding: 'x'.repeat(7_000_000) }, null), /over the/);
});

when('deleting a diary leaves nothing behind, and the next backup starts again at one', async () => {
  // Reset on the You screen has to mean it: a spare copy left on the server
  // after somebody asked to be forgotten is the opposite of what they asked
  // for. And what comes after must not inherit the old version number, or
  // the browser that wrote v4 would find its v5 refused for ever.
  const device = await registerDevice();
  const owner = ownerOf({ id: device.id, accountId: null });
  await writeDiary(owner, { meals: ['lunch'] }, null);

  await deleteDiary(owner);
  assert.equal(await readDiary(owner), null, 'the diary was still there after a delete');

  const fresh = await writeDiary(owner, { meals: [] }, null);
  assert.equal(fresh.ok, true, 'the browser could not start a new backup after resetting');
  assert.equal(fresh.ok && fresh.version, 1);
});

when('deleting a diary that was never there is not an error', async () => {
  const device = await registerDevice();
  await assert.doesNotReject(() => deleteDiary(ownerOf({ id: device.id, accountId: null })));
});
