import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { registerDevice } from '../server/identity';
import { ownerOf, readDiary, writeDiary } from '../server/diary';
import {
  accountFor,
  changePassword,
  completeReset,
  deleteAccount,
  looksLikeEmail,
  normaliseEmail,
  requestReset,
  signIn,
  signOut,
  signUp,
  sweepResets,
  verifyPassword,
} from '../server/accounts';

/**
 * Accounts, against a real Postgres.
 *
 * Skipped without a DATABASE_URL, the same condition the app itself checks.
 * A great deal of what is worth testing here is what happens to somebody's
 * diary when they sign up, sign in on a second phone, or delete the lot —
 * and none of that can be tested against a mock, because the interesting
 * part is which rows moved.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

let n = 0;
const anEmail = () => `person${++n}-${Date.now()}@example.com`;

before(async () => {
  if (!enabled) return;
  await migrate();
  await query('truncate resets, usage, diaries, devices, accounts cascade');
});

after(async () => {
  if (enabled) await closeDatabase();
});

async function aDeviceWithADiary(meals: string[]) {
  const device = await registerDevice();
  if (meals.length) await writeDiary(ownerOf({ id: device.id, accountId: null }), { meals }, null);
  return device;
}

/* ---------------- signing up ---------------- */

when('signing up brings the diary already logged on this device', async () => {
  // The whole point. Somebody uses Squish for a month, then signs up; the
  // month has to come with them or they will not sign up twice.
  const device = await aDeviceWithADiary(['a month of lunches']);
  const made = await signUp(device.id, anEmail(), 'four random words');
  assert.equal(made.ok, true);
  assert.equal(made.ok && made.broughtDiary, true);

  const account = made.ok ? made.account.id : '';
  assert.deepEqual((await readDiary(account))?.state, { meals: ['a month of lunches'] });
  assert.equal(await readDiary(device.id), null, 'the diary was copied rather than moved, so there are now two');
});

when('the password is not stored, and not recoverable from what is', async () => {
  const device = await registerDevice();
  const made = await signUp(device.id, anEmail(), 'correct horse battery staple');
  const id = made.ok ? made.account.id : '';
  const rows = await query<{ password_hash: string }>('select password_hash from accounts where id = $1', [id]);

  assert.ok(!rows[0].password_hash.includes('horse'), 'the password is in the database');
  assert.match(rows[0].password_hash, /^scrypt\$\d+\$\d+\$\d+\$/, 'the cost has to be stored with the hash or it can never be raised');
});

when('the same address cannot have two accounts, however it is capitalised', async () => {
  const email = anEmail();
  const first = await registerDevice();
  assert.equal((await signUp(first.id, email, 'four random words')).ok, true);

  const second = await registerDevice();
  const again = await signUp(second.id, email.toUpperCase(), 'four other words');
  assert.equal(again.ok, false);
  assert.equal(!again.ok && again.reason, 'taken');
});

when('an address that is not one, and a password too short to be one, are refused', async () => {
  const device = await registerDevice();
  assert.equal(!(await signUp(device.id, 'not an address', 'four random words')).ok, true);
  assert.equal(!(await signUp(device.id, anEmail(), 'short')).ok, true);

  assert.equal(looksLikeEmail('someone@example.com'), true);
  assert.equal(looksLikeEmail('someone@example'), false);
  assert.equal(normaliseEmail('  Someone@Example.COM '), 'someone@example.com');
});

/* ---------------- signing in ---------------- */

when('signing in on a second phone brings that phone\'s diary if the account has none', async () => {
  const email = anEmail();
  const first = await registerDevice();
  await signUp(first.id, email, 'four random words');
  // The account owns nothing: the first device had no diary to bring.
  const second = await aDeviceWithADiary(['logged on the new phone']);

  const back = await signIn(second.id, email, 'four random words');
  assert.equal(back.ok, true);
  assert.equal(back.ok && back.broughtDiary, true);
  assert.deepEqual((await readDiary(back.ok ? back.account.id : ''))?.state, { meals: ['logged on the new phone'] });
});

when('signing in never merges two real diaries, and says it did not', async () => {
  // The dangerous case. Both sides have a diary; picking one by machine means
  // guessing whether two similar lunches are one lunch logged twice.
  const email = anEmail();
  const first = await aDeviceWithADiary(['the account\'s six weeks']);
  const made = await signUp(first.id, email, 'four random words');
  const account = made.ok ? made.account.id : '';

  const second = await aDeviceWithADiary(['a week on the other phone']);
  const back = await signIn(second.id, email, 'four random words');

  assert.equal(back.ok, true);
  assert.equal(back.ok && back.broughtDiary, false, 'the browser was told its diary was taken when it was not');
  assert.deepEqual((await readDiary(account))?.state, { meals: ['the account\'s six weeks'] }, 'the account\'s diary was overwritten');
  assert.deepEqual((await readDiary(second.id))?.state, { meals: ['a week on the other phone'] }, 'and the phone\'s was thrown away');
});

when('a wrong password and an address with no account are the same answer', async () => {
  const email = anEmail();
  const device = await registerDevice();
  await signUp(device.id, email, 'four random words');

  const wrong = await signIn(device.id, email, 'four other words');
  const missing = await signIn(device.id, anEmail(), 'four random words');
  assert.equal(!wrong.ok && wrong.reason, 'wrong');
  assert.equal(!missing.ok && missing.reason, 'wrong');
});

when('signing out detaches the device and leaves the account holding the diary', async () => {
  const email = anEmail();
  const device = await aDeviceWithADiary(['six weeks']);
  const made = await signUp(device.id, email, 'four random words');
  const account = made.ok ? made.account.id : '';

  await signOut(device.id);
  const rows = await query<{ account_id: string | null }>('select account_id from devices where id = $1', [device.id]);
  assert.equal(rows[0].account_id, null);
  assert.deepEqual((await readDiary(account))?.state, { meals: ['six weeks'] }, 'signing out took the diary with it');
});

/* ---------------- deleting ---------------- */

when('deleting an account takes the diary with it and leaves the phone working', async () => {
  // Both app stores require this from inside the app, and it is the only
  // honest answer to being asked to be forgotten.
  const email = anEmail();
  const device = await aDeviceWithADiary(['everything']);
  const made = await signUp(device.id, email, 'four random words');
  const account = made.ok ? made.account.id : '';

  await deleteAccount(account);
  assert.equal(await accountFor(account), null);
  assert.equal(await readDiary(account), null, 'the diary outlived the account it belonged to');

  const rows = await query<{ account_id: string | null }>('select account_id from devices where id = $1', [device.id]);
  assert.equal(rows[0].account_id, null, 'the device was deleted along with the account');

  const fresh = await writeDiary(ownerOf({ id: device.id, accountId: null }), { meals: ['starting again'] }, null);
  assert.equal(fresh.ok, true, 'the phone could not back up again after the account went');
});

when('the address is free again once the account is deleted', async () => {
  const email = anEmail();
  const device = await registerDevice();
  const made = await signUp(device.id, email, 'four random words');
  await deleteAccount(made.ok ? made.account.id : '');

  const again = await signUp(device.id, email, 'four different words');
  assert.equal(again.ok, true);
});

/* ---------------- changing the password ---------------- */

when('the password changes only for somebody who knows the old one', async () => {
  const email = anEmail();
  const device = await registerDevice();
  const made = await signUp(device.id, email, 'four random words');
  const account = made.ok ? made.account.id : '';

  assert.equal((await changePassword(account, 'not the password', 'four new words')).ok, false);
  assert.equal((await changePassword(account, 'four random words', 'short')).ok, false);
  assert.equal((await changePassword(account, 'four random words', 'four new words')).ok, true);

  assert.equal((await signIn(device.id, email, 'four random words')).ok, false, 'the old password still works');
  assert.equal((await signIn(device.id, email, 'four new words')).ok, true);
});

/* ---------------- forgotten passwords ---------------- */

async function tokenFor(email: string): Promise<string> {
  let sent = '';
  await requestReset(email, (token) => {
    sent = token;
    return `https://squish.example/reset?token=${token}`;
  });
  return sent;
}

when('a reset link sets a new password, once', async () => {
  const email = anEmail();
  const device = await registerDevice();
  await signUp(device.id, email, 'four random words');

  const token = await tokenFor(email);
  assert.ok(token.length >= 40);

  assert.equal((await completeReset(token, 'four brand new words')).ok, true);
  assert.equal((await signIn(device.id, email, 'four brand new words')).ok, true);

  const again = await completeReset(token, 'four sneaky words');
  assert.equal(again.ok, false, 'a spent link worked a second time');
  assert.equal(!again.ok && again.reason, 'bad_token');
});

when('the reset token is not stored, only a hash of it', async () => {
  const email = anEmail();
  const device = await registerDevice();
  await signUp(device.id, email, 'four random words');
  const token = await tokenFor(email);

  const rows = await query<{ token_hash: string }>('select token_hash from resets');
  assert.ok(rows.length > 0);
  assert.ok(!rows.some((row) => row.token_hash === token), 'the token itself is in the database');
});

when('asking to reset an address with no account looks exactly like asking about one that has', async () => {
  // An endpoint that says "no such account" is a tool for finding out who has
  // one, and the people most interested in that list are not the forgetful.
  let called = false;
  await assert.doesNotReject(() => requestReset(anEmail(), (token) => { called = true; return token; }));
  assert.equal(called, false, 'a link was minted for an account that does not exist');
});

when('changing the password voids every reset link outstanding', async () => {
  const email = anEmail();
  const device = await registerDevice();
  const made = await signUp(device.id, email, 'four random words');
  const token = await tokenFor(email);

  await changePassword(made.ok ? made.account.id : '', 'four random words', 'chosen deliberately here');
  const used = await completeReset(token, 'taken over by someone');
  assert.equal(used.ok, false, 'a link in an old inbox could undo a password change');
});

when('an expired link is no link at all, and gets swept up', async () => {
  const email = anEmail();
  const device = await registerDevice();
  await signUp(device.id, email, 'four random words');
  const token = await tokenFor(email);

  await query("update resets set expires_at = now() - interval '1 minute'");
  const late = await completeReset(token, 'four brand new words');
  assert.equal(late.ok, false);

  await sweepResets();
  const left = await query<{ token_hash: string }>('select token_hash from resets');
  assert.equal(left.length, 0);
});

when('deleting an account does not first hand it the diary sitting on the phone', async () => {
  // Checking a password by signing in would move an unclaimed diary onto the
  // account, and deleting the account a moment later would take it with it.
  // Somebody deleting an account they barely used would lose the diary they
  // did not know was separate from it.
  const email = anEmail();
  const first = await registerDevice();
  const made = await signUp(first.id, email, 'four random words');
  const account = made.ok ? made.account.id : '';

  const phone = await aDeviceWithADiary(['logged here, never uploaded to the account']);
  assert.equal((await verifyPassword(account, 'four random words')), true);
  assert.equal((await verifyPassword(account, 'not the password')), false);

  await deleteAccount(account);
  assert.deepEqual(
    (await readDiary(phone.id))?.state,
    { meals: ['logged here, never uploaded to the account'] },
    'checking the password swallowed the diary on the phone',
  );
});
