/**
 * Sign in with Google, and with Apple.
 *
 * Both hand the browser an ID token: a JWT, signed by Google or Apple, that
 * says which of their accounts this is (`sub`) and its email address. The
 * browser passes it here, and it is believed only once its signature checks
 * out against the provider's published keys, it was issued by them, for
 * Squish (`aud`), recently, and for this attempt (`nonce`).
 *
 * Then one Squish account per person, however they come in:
 *
 * - Seen this Google or Apple account before: that Squish account.
 * - A Squish account on the same, provider-verified address: linked to it.
 *   If that address had never been confirmed, whoever made the account
 *   might not own it — somebody can sign up with another person's address
 *   and wait — so its password is replaced and its other devices signed
 *   out, and the address's real owner has the account.
 * - Neither: a new account, its address already confirmed, with a password
 *   nobody knows. "Forgotten password" sets one, for anybody who later wants
 *   to sign in without Google or Apple.
 *
 * Configured by environment (docs/sign-in-with.md): GOOGLE_CLIENT_ID for
 * Google, APPLE_CLIENT_ID (a Services ID) for Apple. Without one, that
 * button is not offered.
 */
import { createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';
import { hasDatabase, migrate, transaction } from './db';
import { hashPassword, looksLikeEmail, normaliseEmail, type Account } from './accounts';

export type Provider = 'google' | 'apple';
export const isProvider = (value: unknown): value is Provider => value === 'google' || value === 'apple';

const ISSUERS: Record<Provider, string[]> = {
  google: ['accounts.google.com', 'https://accounts.google.com'],
  apple: ['https://appleid.apple.com'],
};

const KEYS_URL: Record<Provider, string> = {
  google: 'https://www.googleapis.com/oauth2/v3/certs',
  apple: 'https://appleid.apple.com/auth/keys',
};

/** Which client ids a token may be for. Comma-separated, so a web id and an app's can both be accepted. */
export function audiences(provider: Provider): string[] {
  const raw = provider === 'google' ? process.env.GOOGLE_CLIENT_ID : process.env.APPLE_CLIENT_ID;
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/** What the app needs to show the buttons: the web client ids, or null where one is not set up. */
export function providerSetup(origin: string): { google: { clientId: string } | null; apple: { clientId: string; redirectUri: string } | null } {
  const [google] = audiences('google');
  const [apple] = audiences('apple');
  return {
    google: google ? { clientId: google } : null,
    // With the popup, Apple still wants a return address registered for the Services ID: this origin.
    apple: apple ? { clientId: apple, redirectUri: process.env.APPLE_REDIRECT_URI || `${origin}/` } : null,
  };
}

/* ---------------- checking a token ---------------- */

type Jwk = JsonWebKey & { kid?: string; alg?: string };
export type KeyFetcher = (provider: Provider) => Promise<Jwk[]>;

const cache = new Map<Provider, { keys: Jwk[]; at: number }>();
const KEYS_KEEP_MS = 60 * 60_000;
/** A key we have not seen may be a new one: fetched again, but not more than this often. */
const KEYS_RETRY_MS = 60_000;

async function fetchKeys(provider: Provider): Promise<Jwk[]> {
  const response = await fetch(KEYS_URL[provider], { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${provider} keys: ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  return body.keys ?? [];
}

async function keyFor(provider: Provider, kid: string, fetcher: KeyFetcher): Promise<Jwk | undefined> {
  const held = cache.get(provider);
  const fresh = held && Date.now() - held.at < KEYS_KEEP_MS;
  let found = fresh ? held.keys.find((k) => k.kid === kid) : undefined;
  if (!found && (!held || Date.now() - held.at > KEYS_RETRY_MS || !fresh)) {
    const keys = await fetcher(provider);
    cache.set(provider, { keys, at: Date.now() });
    found = keys.find((k) => k.kid === kid);
  }
  return found;
}

/** For the tests: forget the keys, so the next check fetches them. */
export const forgetKeys = (): void => cache.clear();

export interface Identity {
  provider: Provider;
  /** Their id at Google or Apple: stable, unlike an email address. */
  subject: string;
  /** Lowercased; absent when the provider would not say. */
  email?: string;
}

export class BadToken extends Error {}

const b64 = (part: string): Buffer => Buffer.from(part, 'base64url');
/** Apple sends booleans as strings. */
const truthy = (value: unknown): boolean => value === true || value === 'true';
const SKEW_S = 120;

/**
 * Check a token and say whose it is — or throw BadToken. Every check, in
 * order: shape, algorithm, signature, issuer, audience, expiry, nonce, email.
 */
export async function verifyIdToken(
  provider: Provider,
  token: string,
  nonce: string,
  options: { audiences?: string[]; fetcher?: KeyFetcher; now?: number } = {},
): Promise<Identity> {
  const allowed = options.audiences ?? audiences(provider);
  if (!allowed.length) throw new BadToken(`${provider} sign-in is not set up`);
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new BadToken('not a token');
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(b64(parts[0]).toString('utf8'));
    claims = JSON.parse(b64(parts[1]).toString('utf8'));
  } catch {
    throw new BadToken('unreadable token');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new BadToken('unexpected signing');

  const jwk = await keyFor(provider, header.kid, options.fetcher ?? fetchKeys);
  if (!jwk) throw new BadToken('unknown key');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2]))) throw new BadToken('bad signature');

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (!ISSUERS[provider].includes(String(claims.iss))) throw new BadToken('wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud)];
  if (!aud.some((a) => allowed.includes(a))) throw new BadToken('not for Squish');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < now) throw new BadToken('expired');
  if (typeof claims.iat === 'number' && claims.iat - SKEW_S > now) throw new BadToken('from the future');
  if (!nonce || claims.nonce !== nonce) throw new BadToken('not this attempt');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new BadToken('nobody');

  const email = typeof claims.email === 'string' ? normaliseEmail(claims.email) : '';
  // An address the provider has not checked is not one to link an account by.
  const usable = email && looksLikeEmail(email) && truthy(claims.email_verified);
  return { provider, subject: claims.sub, email: usable ? email : undefined };
}

/* ---------------- one account per person ---------------- */

export type Entered =
  | { ok: true; account: Account; created: boolean; broughtDiary: boolean }
  | { ok: false; reason: 'no_email' };

/**
 * Sign this device in as whoever the identity belongs to, linking or making
 * the account as the file's opening comment says, and deciding about the
 * diary on the device exactly as a password sign-in does.
 */
export async function enterWith(deviceId: string, who: Identity): Promise<Entered> {
  if (!hasDatabase()) throw new Error('No database.');
  await migrate();
  const spare = await hashPassword(randomBytes(32).toString('hex'));

  return transaction(async (client) => {
    let account: Account | undefined;
    let created = false;

    const linked = await client.query<{ id: string; email: string }>(
      `select a.id, a.email from account_identities i join accounts a on a.id = i.account_id
        where i.provider = $1 and i.subject = $2`,
      [who.provider, who.subject],
    );
    account = linked.rows[0];

    if (!account) {
      if (!who.email) return { ok: false as const, reason: 'no_email' as const };
      const same = await client.query<{ id: string; email: string; verified: boolean }>(
        'select id, email, email_verified_at is not null as verified from accounts where email = $1 for update',
        [who.email],
      );
      const existing = same.rows[0];
      if (existing) {
        if (!existing.verified) {
          // Never proven to belong to whoever made it: theirs no longer.
          await client.query('update accounts set password_hash = $2, email_verified_at = now() where id = $1', [existing.id, spare]);
          await client.query('update devices set account_id = null where account_id = $1 and id <> $2', [existing.id, deviceId]);
        }
        account = { id: existing.id, email: existing.email };
      } else {
        const id = randomBytes(9).toString('base64url');
        await client.query('insert into accounts (id, email, password_hash, email_verified_at) values ($1, $2, $3, now())', [id, who.email, spare]);
        account = { id, email: who.email };
        created = true;
      }
      await client.query('insert into account_identities (provider, subject, account_id) values ($1, $2, $3) on conflict do nothing', [
        who.provider,
        who.subject,
        account.id,
      ]);
    }

    // As signIn does: this device is theirs now, and its diary becomes the
    // account's only where the account has none.
    await client.query('update devices set account_id = $1 where id = $2', [account.id, deviceId]);
    await client.query('delete from admin_sessions where device_id = $1', [deviceId]);
    const held = await client.query('select 1 from diaries where owner_id = $1', [account.id]);
    let broughtDiary = false;
    if ((held.rowCount ?? 0) === 0) {
      const moved = await client.query('update diaries set owner_id = $1 where owner_id = $2', [account.id, deviceId]);
      broughtDiary = (moved.rowCount ?? 0) > 0;
    }
    return { ok: true as const, account, created, broughtDiary };
  });
}
