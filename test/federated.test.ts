import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { generateKeyPairSync, sign, type JsonWebKey } from 'node:crypto';
import { BadToken, enterWith, forgetKeys, verifyIdToken, type Provider } from '../server/federated';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { registerDevice } from '../server/identity';
import { signUp, verifyPassword } from '../server/accounts';

/**
 * Sign in with Google and Apple: a token is believed only when every part of
 * it checks out, and one person ends up with one account however they come
 * in — without letting somebody who signed up with another person's address
 * keep the account once its real owner arrives.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: stranger } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1', alg: 'RS256' };
const fetcher = async () => [jwk];
const AUD = 'squish-web.apps.example';
const NOW = Date.UTC(2026, 8, 27, 12);

function token(claims: Record<string, unknown>, options: { key?: typeof privateKey; kid?: string; alg?: string } = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'k1', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: AUD,
      sub: '1234567890',
      email: 'Robin@Example.com',
      email_verified: true,
      nonce: 'n-1',
      iat: NOW / 1000 - 10,
      exp: NOW / 1000 + 3600,
      ...claims,
    }),
  ).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), options.key ?? privateKey).toString('base64url');
  return `${header}.${body}.${signature}`;
}

const check = (t: string, nonce = 'n-1', provider: Provider = 'google') => verifyIdToken(provider, t, nonce, { audiences: [AUD], fetcher, now: NOW });

test('a good token says whose it is, the address lowercased', async () => {
  forgetKeys();
  assert.deepEqual(await check(token({})), { provider: 'google', subject: '1234567890', email: 'robin@example.com' });
  // Apple sends its booleans as strings, and has its own issuer.
  forgetKeys();
  const apple = await check(token({ iss: 'https://appleid.apple.com', email_verified: 'true' }), 'n-1', 'apple');
  assert.equal(apple.email, 'robin@example.com');
});

test('every part of a token is checked', async () => {
  const refused = async (t: string, why: RegExp, nonce = 'n-1') => {
    forgetKeys();
    await assert.rejects(check(t, nonce), (error: unknown) => error instanceof BadToken && why.test(error.message));
  };
  await refused(token({}, { key: stranger }), /signature/);
  await refused(token({}, { kid: 'nope' }), /unknown key/);
  await refused(token({}, { alg: 'HS256' }), /signing/);
  await refused(token({ iss: 'https://evil.example' }), /issuer/);
  await refused(token({ aud: 'someone-else' }), /not for Squish/);
  await refused(token({ exp: NOW / 1000 - 600 }), /expired/);
  await refused(token({}), /not this attempt/, 'n-2');
  await refused(token({ nonce: undefined }), /not this attempt/, '');
  await refused('not.a', /not a token/);
  // Apple's issuer on a Google token, or the reverse, is not accepted.
  forgetKeys();
  await assert.rejects(check(token({}), 'n-1', 'apple'), /issuer/);
});

test('an address the provider has not verified is not one to link by', async () => {
  forgetKeys();
  const who = await check(token({ email_verified: false }));
  assert.equal(who.email, undefined);
});

test('not offered at all until it is set up', async () => {
  await assert.rejects(verifyIdToken('google', token({}), 'n-1', { audiences: [], fetcher }), /not set up/);
});

/* ---------------- one account per person ---------------- */

const enabled = hasDatabase();
const when = enabled ? test : test.skip;
before(async () => {
  if (enabled) await migrate();
});
after(async () => {
  if (enabled) await closeDatabase();
});
let n = 0;
const anEmail = () => `fed${++n}-${Date.now()}@example.com`;
const aSubject = () => `sub-${Date.now()}-${++n}`;

when('a new person gets a new account, its address already confirmed', async () => {
  const device = await registerDevice();
  const email = anEmail();
  const entered = await enterWith(device.id, { provider: 'google', subject: aSubject(), email });
  assert.ok(entered.ok && entered.created);
  const [row] = await query<{ verified: boolean }>('select email_verified_at is not null as verified from accounts where email = $1', [email]);
  assert.equal(row.verified, true);
  const [held] = await query<{ account_id: string }>('select account_id from devices where id = $1', [device.id]);
  assert.equal(held.account_id, entered.account.id);
});

when('the same Google account comes back to the same Squish account, even from another address', async () => {
  const subject = aSubject();
  const first = await enterWith((await registerDevice()).id, { provider: 'apple', subject, email: anEmail() });
  const again = await enterWith((await registerDevice()).id, { provider: 'apple', subject, email: anEmail() });
  assert.ok(first.ok && again.ok);
  assert.equal(again.account.id, first.account.id);
  assert.equal(again.created, false);
});

when('an account made with a password, and confirmed, is linked and keeps its password', async () => {
  const email = anEmail();
  const made = await signUp((await registerDevice()).id, email, 'four random words');
  assert.ok(made.ok);
  await query('update accounts set email_verified_at = now() where id = $1', [made.account.id]);
  const entered = await enterWith((await registerDevice()).id, { provider: 'google', subject: aSubject(), email });
  assert.ok(entered.ok);
  assert.equal(entered.account.id, made.account.id);
  assert.equal(entered.created, false);
  assert.ok(await verifyPassword(made.account.id, 'four random words'));
});

when('an unconfirmed account on somebody else’s address is theirs once they arrive: its password and devices go', async () => {
  const email = anEmail();
  const squatter = await registerDevice();
  const made = await signUp(squatter.id, email, 'four random words');
  assert.ok(made.ok);
  const owner = await registerDevice();
  const entered = await enterWith(owner.id, { provider: 'google', subject: aSubject(), email });
  assert.ok(entered.ok);
  assert.equal(entered.account.id, made.account.id);
  assert.equal(await verifyPassword(made.account.id, 'four random words'), false, 'the password somebody else chose no longer works');
  const [gone] = await query<{ account_id: string | null }>('select account_id from devices where id = $1', [squatter.id]);
  assert.equal(gone.account_id, null, 'and their device is signed out');
});

when('with no address and nothing linked, there is nothing to make an account from', async () => {
  const entered = await enterWith((await registerDevice()).id, { provider: 'apple', subject: aSubject() });
  assert.deepEqual(entered, { ok: false, reason: 'no_email' });
});
