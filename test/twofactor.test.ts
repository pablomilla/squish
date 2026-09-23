import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate } from '../server/db';
import { registerDevice } from '../server/identity';
import { signIn, signOut, signUp } from '../server/accounts';
import {
  LOCK_MINUTES,
  MAX_FAILURES,
  beginSetup,
  checkCode,
  codeAt,
  endSession,
  finishSetup,
  fromBase32,
  hasPassed,
  replaceRecoveryCodes,
  resetTwoFactor,
  stateFor,
  toBase32,
} from '../server/twofactor';

/**
 * The dashboard's second step.
 *
 * The arithmetic is checked against the RFC's own numbers, because a TOTP that
 * is subtly wrong still produces six digits — it just produces different ones
 * from the phone, and the first anybody would know is being locked out.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

let n = 0;
const anEmail = () => `twofactor${++n}-${Date.now()}@example.com`;
const PASSWORD = 'four random words';

before(async () => {
  if (enabled) await migrate();
});

after(async () => {
  if (enabled) await closeDatabase();
});

async function anAdmin() {
  const device = await registerDevice();
  const email = anEmail();
  const made = await signUp(device.id, email, PASSWORD);
  assert.ok(made.ok);
  return { id: made.account.id, email, deviceId: device.id };
}

/** Somebody who has already switched it on, at a known moment. */
async function enrolled(at = Date.now()) {
  const admin = await anAdmin();
  const setup = await beginSetup(admin.id, admin.email);
  assert.ok(setup);
  const done = await finishSetup(admin.id, admin.deviceId, codeAt(setup.secret, at), at);
  assert.ok(done.ok);
  return { ...admin, secret: setup.secret, recoveryCodes: done.recoveryCodes ?? [] };
}

/* ---------------- the arithmetic ---------------- */

test('codes match RFC 6238’s test vectors', () => {
  // The RFC's SHA-1 key is the ASCII "12345678901234567890"; its answers are
  // eight digits, of which an authenticator app shows the last six.
  const secret = toBase32(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(codeAt(secret, 59_000), '287082');
  assert.equal(codeAt(secret, 1_111_111_109_000), '081804');
  assert.equal(codeAt(secret, 1_234_567_890_000), '005924');
  assert.equal(codeAt(secret, 2_000_000_000_000), '279037');
});

test('base32 survives the round trip, whatever the length', () => {
  for (const length of [1, 5, 10, 19, 20, 32]) {
    const bytes = Buffer.from(Array.from({ length }, (_, i) => (i * 37 + 11) % 256));
    assert.deepEqual(fromBase32(toBase32(bytes)), bytes);
  }
  assert.deepEqual(fromBase32('gezd gnbv'), fromBase32('GEZDGNBV'), 'case and spaces are how people type it');
});

/* ---------------- setting up ---------------- */

when('it is not on until a code proves the app has the secret', async () => {
  const admin = await anAdmin();
  const setup = await beginSetup(admin.id, admin.email);
  assert.ok(setup);
  assert.match(setup.uri, /^otpauth:\/\/totp\/Squish%3A/);
  assert.ok(setup.uri.includes(`secret=${setup.secret}`));
  assert.match(setup.qr, /^data:image\/svg\+xml;base64,/);

  assert.equal((await stateFor(admin.id, admin.deviceId)).enrolled, false);
  assert.equal(await hasPassed(admin.id, admin.deviceId), false);

  const wrong = await finishSetup(admin.id, admin.deviceId, '000000');
  assert.equal(wrong.ok, false);
  assert.equal((await stateFor(admin.id, admin.deviceId)).enrolled, false);

  const right = await finishSetup(admin.id, admin.deviceId, codeAt(setup.secret));
  assert.ok(right.ok);
  assert.equal(right.recoveryCodes?.length, 10);
  assert.equal(new Set(right.recoveryCodes).size, 10);
  assert.ok(await hasPassed(admin.id, admin.deviceId), 'the device that set it up is let straight in');

  const state = await stateFor(admin.id, admin.deviceId);
  assert.equal(state.enrolled, true);
  assert.equal(state.recoveryLeft, 10);
});

when('asking again before finishing replaces the secret; after, it is refused', async () => {
  const admin = await anAdmin();
  const first = await beginSetup(admin.id, admin.email);
  const second = await beginSetup(admin.id, admin.email);
  assert.ok(first && second);
  assert.notEqual(first.secret, second.secret);
  const stale = await finishSetup(admin.id, admin.deviceId, codeAt(first.secret));
  assert.equal(stale.ok, false, 'a QR code that was replaced must stop working');

  const done = await finishSetup(admin.id, admin.deviceId, codeAt(second.secret));
  assert.ok(done.ok);
  assert.equal(await beginSetup(admin.id, admin.email), null, 'a signed-in device cannot swap the app once it is on');
});

/* ---------------- every visit after ---------------- */

when('another device has to pass it too', async () => {
  const admin = await enrolled();
  const laptop = await registerDevice();
  await signIn(laptop.id, admin.email, PASSWORD);
  assert.equal(await hasPassed(admin.id, laptop.id), false);

  const later = Date.now() + 30_000;
  const done = await checkCode(admin.id, laptop.id, codeAt(admin.secret, later), later);
  assert.ok(done.ok);
  assert.ok(await hasPassed(admin.id, laptop.id));
});

when('a code works once', async () => {
  const start = Date.now();
  const admin = await enrolled(start);
  const laptop = await registerDevice();

  const same = await checkCode(admin.id, laptop.id, codeAt(admin.secret, start), start);
  assert.equal(same.ok, false, 'the code used to switch it on cannot be used again');

  const next = start + 30_000;
  assert.ok((await checkCode(admin.id, laptop.id, codeAt(admin.secret, next), next)).ok);
  const again = await checkCode(admin.id, laptop.id, codeAt(admin.secret, next), next);
  assert.equal(again.ok, false, 'nor can any other, once accepted');
});

when('a phone a little out is fine; a code from a minute ago is not', async () => {
  const start = Date.now();
  const admin = await enrolled(start - 5 * 60_000);
  const laptop = await registerDevice();

  const behind = await checkCode(admin.id, laptop.id, codeAt(admin.secret, start - 30_000), start);
  assert.ok(behind.ok, 'one window behind is a slow clock');
  const stale = await checkCode(admin.id, laptop.id, codeAt(admin.secret, start - 90_000), start + 30_000);
  assert.equal(stale.ok, false, 'four windows behind is not');
});

when(`${MAX_FAILURES} wrong codes lock it, even against the right one`, async () => {
  const start = Date.now() - 60_000;
  const admin = await enrolled(start);
  const laptop = await registerDevice();

  for (let i = 0; i < MAX_FAILURES; i++) {
    const wrong = await checkCode(admin.id, laptop.id, '123456');
    assert.equal(wrong.ok, false);
  }
  const right = await checkCode(admin.id, laptop.id, codeAt(admin.secret));
  assert.equal(right.ok, false);
  assert.equal(right.ok === false && right.reason, 'locked');
  assert.ok(right.ok === false && right.minutes && right.minutes <= LOCK_MINUTES);
  assert.equal(await hasPassed(admin.id, laptop.id), false);
});

when('fewer wrong codes than the limit, then a right one, starts the count again', async () => {
  const start = Date.now() - 60_000;
  const admin = await enrolled(start);
  const laptop = await registerDevice();
  for (let i = 0; i < MAX_FAILURES - 1; i++) await checkCode(admin.id, laptop.id, '123456');
  assert.ok((await checkCode(admin.id, laptop.id, codeAt(admin.secret))).ok);
  for (let i = 0; i < MAX_FAILURES - 1; i++) await checkCode(admin.id, laptop.id, '123456');
  const later = Date.now() + 30_000;
  assert.ok((await checkCode(admin.id, laptop.id, codeAt(admin.secret, later), later)).ok, 'not locked yet');
});

/* ---------------- recovery codes ---------------- */

when('a recovery code opens it once, however it is typed', async () => {
  const admin = await enrolled();
  const laptop = await registerDevice();
  const [code] = admin.recoveryCodes;
  assert.match(code, /^[a-z2-9]{5}-[a-z2-9]{5}$/);

  const typed = ` ${code.toUpperCase().replace('-', ' ')} `;
  const used = await checkCode(admin.id, laptop.id, typed);
  assert.ok(used.ok);
  assert.equal(used.ok && used.usedRecovery, true);
  assert.equal(used.ok && used.recoveryLeft, 9);

  const phone = await registerDevice();
  const twice = await checkCode(admin.id, phone.id, code);
  assert.equal(twice.ok, false, 'each one is good once');
});

when('new recovery codes retire the old ones', async () => {
  const admin = await enrolled();
  const fresh = await replaceRecoveryCodes(admin.id);
  assert.equal(fresh.length, 10);
  const laptop = await registerDevice();
  assert.equal((await checkCode(admin.id, laptop.id, admin.recoveryCodes[0])).ok, false);
  assert.ok((await checkCode(admin.id, laptop.id, fresh[0])).ok);
});

/* ---------------- how long a pass lasts ---------------- */

when('signing out, signing in again, or locking ends the pass', async () => {
  const admin = await enrolled();
  assert.ok(await hasPassed(admin.id, admin.deviceId));

  await endSession(admin.deviceId);
  assert.equal(await hasPassed(admin.id, admin.deviceId), false, 'Lock means now');

  let at = Date.now() + 30_000;
  await checkCode(admin.id, admin.deviceId, codeAt(admin.secret, at), at);
  await signOut(admin.deviceId);
  await signIn(admin.deviceId, admin.email, PASSWORD);
  assert.equal(await hasPassed(admin.id, admin.deviceId), false, 'a new sign-in starts without it');

  at += 30_000;
  await checkCode(admin.id, admin.deviceId, codeAt(admin.secret, at), at);
  await signIn(admin.deviceId, admin.email, PASSWORD);
  assert.equal(await hasPassed(admin.id, admin.deviceId), false, 'even signing in over the top of it');
});

when('a pass belongs to the account, not just the device', async () => {
  const admin = await enrolled();
  const other = await anAdmin();
  assert.equal(await hasPassed(other.id, admin.deviceId), false);
});

when('resetting from the server takes it all away', async () => {
  const admin = await enrolled();
  await resetTwoFactor(admin.id);
  const state = await stateFor(admin.id, admin.deviceId);
  assert.equal(state.enrolled, false);
  assert.equal(await hasPassed(admin.id, admin.deviceId), false);
  assert.ok(await beginSetup(admin.id, admin.email), 'and it can be set up again');
});
