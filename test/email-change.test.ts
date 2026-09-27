import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { registerDevice } from '../server/identity';
import { signUp, verifyPassword } from '../server/accounts';
import { confirmEmailChange, peekEmailChange, peekEmailUndo, requestEmailChange, undoEmailChange } from '../server/emailChange';

/**
 * Changing an account's email: the password first, the new inbox proved, the
 * old one told with a way back — and the way back assumes the worst.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;
const ORIGIN = 'https://app.squish.online';
const PASSWORD = 'four words i remember';

// A stand-in mail provider, keeping every email it is handed.
const sent: { to: string; subject: string; text: string }[] = [];
const provider = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    sent.push(JSON.parse(body));
    res.end('{}');
  });
});
let savedWebhook: string | undefined;

before(async () => {
  if (!enabled) return;
  await migrate();
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', () => resolve()));
  savedWebhook = process.env.SQUISH_MAIL_WEBHOOK;
  process.env.SQUISH_MAIL_WEBHOOK = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/`;
});
after(async () => {
  if (!enabled) return;
  if (savedWebhook === undefined) delete process.env.SQUISH_MAIL_WEBHOOK;
  else process.env.SQUISH_MAIL_WEBHOOK = savedWebhook;
  provider.close();
  await closeDatabase();
});

const address = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.com`;
async function anAccount(label: string, confirmed = true) {
  const device = await registerDevice();
  const email = address(label);
  const made = await signUp(device.id, email, PASSWORD);
  assert.ok(made.ok);
  if (confirmed) await query('update accounts set email_verified_at = now() where id = $1', [made.account.id]);
  return { id: made.account.id, device: device.id, email };
}
const mailTo = async (to: string, count = 1) => {
  for (let i = 0; i < 200 && sent.filter((m) => m.to === to).length < count; i++) await new Promise((r) => setTimeout(r, 10));
  return sent.filter((m) => m.to === to);
};
const tokenIn = (text: string, path: string) => new RegExp(`${path.replace('/', '\\/')}\\?token=([\\w%-]+)`).exec(text)?.[1];
const emailOf = async (id: string) => (await query<{ email: string; verified: boolean }>('select email, email_verified_at is not null as verified from accounts where id = $1', [id]))[0];
const changeLink = (token: string) => `${ORIGIN}/email-change?token=${encodeURIComponent(token)}`;
const undoLink = (token: string) => `${ORIGIN}/email-change/undo?token=${encodeURIComponent(token)}`;
const resetLink = (token: string) => `${ORIGIN}/reset?token=${encodeURIComponent(token)}`;

when('the password, a real address and a different one are needed first', async () => {
  const me = await anAccount('first');
  assert.deepEqual(await requestEmailChange(me.id, 'not my password', address('x'), changeLink), { ok: false, reason: 'wrong' });
  assert.deepEqual(await requestEmailChange(me.id, PASSWORD, 'not an address', changeLink), { ok: false, reason: 'bad_email' });
  assert.deepEqual(await requestEmailChange(me.id, PASSWORD, me.email.toUpperCase(), changeLink), { ok: false, reason: 'same' });
});

when('a change waits for the new inbox, and is made by the button, not by opening the link', async () => {
  const me = await anAccount('mover');
  const next = address('moved');
  await query(`insert into resets (token_hash, account_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [`reset-${me.id}`, me.id]);

  assert.deepEqual(await requestEmailChange(me.id, PASSWORD, next.toUpperCase(), changeLink), { ok: true, to: next });
  const [invite] = await mailTo(next);
  assert.equal(invite.subject, 'Confirm your new email for Squish');
  const token = decodeURIComponent(tokenIn(invite.text, '/email-change')!);

  // Opening the link (as a mail scanner would) changes nothing.
  assert.deepEqual(await peekEmailChange(token), { ok: true, accountId: me.id, email: next, done: false });
  assert.equal((await emailOf(me.id)).email, me.email);

  const done = await confirmEmailChange(token, undoLink, ORIGIN);
  assert.deepEqual(done, { ok: true, accountId: me.id, email: next });
  assert.deepEqual(await emailOf(me.id), { email: next, verified: true }, 'following the link proved the new inbox');
  assert.equal((await query('select 1 from resets where account_id = $1', [me.id])).length, 0, 'reset links sent to the old address stop working');

  // The old address is told, with the way back.
  const [notice] = await mailTo(me.email);
  assert.equal(notice.subject, 'Your Squish email address was changed');
  assert.match(notice.text, new RegExp(`changed to ${next.replace('.', '\\.')}`));
  assert.ok(tokenIn(notice.text, '/email-change/undo'));

  // The same button pressed twice: done, and the old address is not told twice.
  assert.deepEqual(await confirmEmailChange(token, undoLink, ORIGIN), { ok: true, accountId: me.id, email: next });
  assert.equal((await peekEmailChange(token) as { done: boolean }).done, true);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await mailTo(me.email)).length, 1);
});

when('the way back puts the address back, signs everything out, locks the password and sends a reset', async () => {
  const me = await anAccount('victim');
  const thief = address('thief');
  await requestEmailChange(me.id, PASSWORD, thief, changeLink);
  const token = decodeURIComponent(tokenIn((await mailTo(thief))[0].text, '/email-change')!);
  await confirmEmailChange(token, undoLink, ORIGIN);
  const undo = decodeURIComponent(tokenIn((await mailTo(me.email))[0].text, '/email-change/undo')!);

  assert.deepEqual(await peekEmailUndo(undo), { ok: true, accountId: me.id, email: me.email }, 'opening it does nothing yet');
  assert.equal((await emailOf(me.id)).email, thief);

  const undone = await undoEmailChange(undo, resetLink);
  assert.deepEqual(undone, { ok: true, accountId: me.id, email: me.email, signedOut: 1 });
  assert.equal((await emailOf(me.id)).email, me.email);
  assert.equal((await query('select 1 from devices where account_id = $1', [me.id])).length, 0, 'every device signed out');
  assert.equal(await verifyPassword(me.id, PASSWORD), false, 'the password whoever moved it knew no longer works');
  const mails = await mailTo(me.email, 2);
  assert.ok(mails.some((m) => m.subject === 'Reset your Squish password' && /\/reset\?token=/.test(m.text)), 'the only way back in, sent to the owner');
  assert.deepEqual(await undoEmailChange(undo, resetLink), { ok: false, reason: 'expired' }, 'once');
});

when('an address that already has an account is never confirmed as one, and is told instead', async () => {
  const me = await anAccount('asker');
  const other = await anAccount('owner');
  assert.deepEqual(await requestEmailChange(me.id, PASSWORD, other.email, changeLink), { ok: true, to: other.email }, 'the same answer as a free address');
  const [note] = await mailTo(other.email);
  assert.equal(note.subject, 'This email already has a Squish account');
  assert.doesNotMatch(note.text, /email-change\?token=/);
  assert.equal((await query('select 1 from email_changes where account_id = $1', [me.id])).length, 0);
});

when('an address taken between the request and the button leaves the account where it was', async () => {
  const me = await anAccount('slow');
  const next = address('contested');
  await requestEmailChange(me.id, PASSWORD, next, changeLink);
  const token = decodeURIComponent(tokenIn((await mailTo(next))[0].text, '/email-change')!);
  const quick = await registerDevice();
  assert.ok((await signUp(quick.id, next, PASSWORD)).ok);
  assert.deepEqual(await confirmEmailChange(token, undoLink, ORIGIN), { ok: false, reason: 'taken' });
  assert.equal((await emailOf(me.id)).email, me.email);
});

when('an old address nobody confirmed is not written to, since it may be a stranger’s', async () => {
  const me = await anAccount('unconfirmed', false);
  const next = address('confirmed-now');
  await requestEmailChange(me.id, PASSWORD, next, changeLink);
  const token = decodeURIComponent(tokenIn((await mailTo(next))[0].text, '/email-change')!);
  assert.ok((await confirmEmailChange(token, undoLink, ORIGIN)).ok);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await mailTo(me.email)).length, 0);
  assert.equal((await query('select 1 from email_undos where account_id = $1', [me.id])).length, 0);
});

when('an old link runs out', async () => {
  const me = await anAccount('late');
  const next = address('too-late');
  await requestEmailChange(me.id, PASSWORD, next, changeLink);
  const token = decodeURIComponent(tokenIn((await mailTo(next))[0].text, '/email-change')!);
  await query(`update email_changes set expires_at = now() - interval '1 minute' where account_id = $1`, [me.id]);
  assert.deepEqual(await peekEmailChange(token), { ok: false });
  assert.deepEqual(await confirmEmailChange(token, undoLink, ORIGIN), { ok: false, reason: 'expired' });
});
