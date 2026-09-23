/**
 * Accounts: a diary that outlives the device it was logged on.
 *
 * The device token underneath this already carries a diary perfectly well, and
 * most people will never need more than that. An account exists for the two
 * things a device cannot do: follow somebody to a new phone, and be got back
 * after the old one went in the sea.
 *
 * Signing in attaches the account to the device row, and the device token
 * stays the only credential anything presents. There are no session tokens
 * because there is nothing for one to do that the device token does not
 * already do — it is already long-lived, already a bearer credential, and
 * already holds the whole diary. Adding a second one would mean two things to
 * expire, two things to leak and two things to get wrong.
 *
 * The password is hashed with scrypt rather than SHA-256. A device token is 32
 * random bytes and there is nothing to guess; a password is something a person
 * chose, which means it is in a list somewhere, which means the only defence
 * is making each guess expensive.
 */
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { migrate, query, transaction } from './db';
import { sendMail } from './mail';
import { judgePassword } from './passwords';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** About 100ms and 16MB per guess on the hardware Squish runs on. */
const COST = { N: 16_384, r: 8, p: 1 };
const KEYLEN = 64;

/**
 * The parameters live in the stored string, not in this file.
 *
 * Hardware gets faster and the cost should go up with it. When it does, an
 * account hashed under the old cost must still be able to sign in — so
 * verification reads the cost out of what was stored rather than assuming
 * whatever is current.
 */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, COST);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Something to compare against when there is no account.
 *
 * Without it, a wrong email comes back in a millisecond and a wrong password
 * takes a hundred, and anybody can work out which addresses have an account
 * here by watching a clock.
 */
const DECOY = hashPassword(randomBytes(32).toString('hex'));

export interface Account {
  id: string;
  email: string;
}

/**
 * One address, one account, however it was typed.
 *
 * Addresses are compared case-insensitively because nobody remembers whether
 * they capitalised anything, and because two accounts differing only in case
 * is a support ticket rather than a feature.
 */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/** Enough to catch a typo, not enough to reject somebody's real address. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * Eight characters and nothing else.
 *
 * No required punctuation, no mixed case, no digit: every one of those rules
 * pushes people towards Passw0rd! and away from four words they can actually
 * remember. Length is the part that helps.
 */
export const MIN_PASSWORD = 8;

export type SignUp =
  | { ok: true; account: Account; broughtDiary: boolean }
  | { ok: false; reason: 'taken' | 'bad_email' | 'weak_password' | 'breached'; message?: string };

/**
 * Make an account and hand this device's diary to it.
 *
 * The diary moves rather than being copied. Somebody who used Squish for a
 * month and then signed up should find their month there, and should not then
 * have two diaries quietly diverging — one belonging to the browser and one to
 * the account.
 */
export async function signUp(deviceId: string, email: string, password: string): Promise<SignUp> {
  await migrate();
  const address = normaliseEmail(email);
  if (!looksLikeEmail(address)) return { ok: false, reason: 'bad_email' };
  if (password.length < MIN_PASSWORD) return { ok: false, reason: 'weak_password' };

  const verdict = await judgePassword(password);
  if (!verdict.ok) return { ok: false, reason: 'breached', message: verdict.message };

  const id = randomBytes(9).toString('base64url');
  const passwordHash = await hashPassword(password);

  try {
    return await transaction(async (client) => {
      await client.query('insert into accounts (id, email, password_hash) values ($1, $2, $3)', [id, address, passwordHash]);
      await client.query('update devices set account_id = $1 where id = $2', [id, deviceId]);
      // A brand new account owns nothing, so there is nothing to collide with
      // and no decision for anybody to make.
      const moved = await client.query('update diaries set owner_id = $1 where owner_id = $2', [id, deviceId]);
      return { ok: true as const, account: { id, email: address }, broughtDiary: (moved.rowCount ?? 0) > 0 };
    });
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, reason: 'taken' };
    throw error;
  }
}

const isDuplicate = (error: unknown): boolean => (error as { code?: string })?.code === '23505';

export type SignIn =
  | { ok: true; account: Account; broughtDiary: boolean }
  | { ok: false; reason: 'wrong' };

/**
 * Sign in, and work out what happens to the diary already on this device.
 *
 * Two cases, and only one of them is a decision. If the account has no diary,
 * this device's becomes it — somebody signing in on a second phone after using
 * Squish there for a week should not lose the week. If the account already has
 * one, nothing is touched: two real diaries cannot be merged by machine, and
 * the browser is told to go and ask, which is the same conversation the backup
 * already knows how to have.
 */
export async function signIn(deviceId: string, email: string, password: string): Promise<SignIn> {
  await migrate();
  const address = normaliseEmail(email);

  const rows = await query<{ id: string; email: string; password_hash: string }>(
    'select id, email, password_hash from accounts where email = $1',
    [address],
  );
  const found = rows[0];
  if (!found) {
    // Spend the same time as a real attempt before saying no.
    await passwordMatches(password, await DECOY);
    return { ok: false, reason: 'wrong' };
  }
  if (!(await passwordMatches(password, found.password_hash))) return { ok: false, reason: 'wrong' };

  const broughtDiary = await transaction(async (client) => {
    await client.query('update devices set account_id = $1 where id = $2', [found.id, deviceId]);
    const held = await client.query('select 1 from diaries where owner_id = $1', [found.id]);
    if ((held.rowCount ?? 0) > 0) return false;
    const moved = await client.query('update diaries set owner_id = $1 where owner_id = $2', [found.id, deviceId]);
    return (moved.rowCount ?? 0) > 0;
  });

  return { ok: true, account: { id: found.id, email: found.email }, broughtDiary };
}

/**
 * Sign out: this device stops being the account's.
 *
 * The account's diary stays with the account and this device goes back to
 * owning nothing on the server, which is where a device that has never signed
 * in already is. What is in the browser is untouched — signing out of a backup
 * should never take somebody's lunch off their screen.
 */
export async function signOut(deviceId: string): Promise<void> {
  await migrate();
  await query('update devices set account_id = null where id = $1', [deviceId]);
}

/**
 * Is this the account's password? Nothing else.
 *
 * Separate from signIn because the two are asked for different reasons.
 * Signing in also decides what happens to the diary on the device, and
 * anywhere that only wants to be sure who is asking — deleting an account,
 * most of all — must not quietly move a diary as a side effect of checking.
 */
export async function verifyPassword(id: string, password: string): Promise<boolean> {
  await migrate();
  const rows = await query<{ password_hash: string }>('select password_hash from accounts where id = $1', [id]);
  const found = rows[0];
  if (!found) {
    await passwordMatches(password, await DECOY);
    return false;
  }
  return passwordMatches(password, found.password_hash);
}

/**
 * How many other devices are signed into this account.
 *
 * Shown rather than guessed at, because "sign out my other devices" is a
 * button somebody presses when they are worried, and a number is the
 * difference between reassurance and more worry.
 */
export async function otherDevices(accountId: string, exceptDeviceId: string): Promise<number> {
  await migrate();
  const rows = await query<{ n: string }>(
    'select count(*) as n from devices where account_id = $1 and id <> $2',
    [accountId, exceptDeviceId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Cut every other device loose from this account.
 *
 * The thing this is for is a phone somebody no longer has. A device token is
 * a bearer credential with no expiry — whoever holds it is that device — so
 * until this existed, losing a phone meant whoever found it stayed signed in
 * for ever, and changing the password did not help because the password is
 * not what the token proves.
 *
 * The devices are detached rather than deleted. They go on working as
 * anonymous devices, which is what they were before anybody signed in, and
 * what is already on them stays theirs. What they lose is the account, and
 * with it the diary on the server.
 */
export async function signOutEverywhere(accountId: string, exceptDeviceId: string): Promise<number> {
  await migrate();
  const rows = await query<{ id: string }>(
    'update devices set account_id = null where account_id = $1 and id <> $2 returning id',
    [accountId, exceptDeviceId],
  );
  return rows.length;
}

export async function accountFor(id: string): Promise<Account | null> {
  await migrate();
  const rows = await query<{ id: string; email: string }>('select id, email from accounts where id = $1', [id]);
  return rows[0] ?? null;
}

/**
 * Delete the account and everything it holds.
 *
 * Required by both app stores: an account made in an app has to be deletable
 * from inside it, not by emailing somebody. It is also the only honest
 * response to being asked to be forgotten.
 *
 * The devices survive, detached — somebody deleting an account should not find
 * their phone unable to log lunch. What they lose is the copy on the server,
 * which is what they asked to lose.
 */
export async function deleteAccount(id: string): Promise<void> {
  await migrate();
  await transaction(async (client) => {
    await client.query('delete from diaries where owner_id = $1', [id]);
    await client.query('delete from accounts where id = $1', [id]);
  });
}

export type PasswordChange = { ok: true } | { ok: false; reason: 'wrong' | 'weak_password' | 'breached'; message?: string };

export async function changePassword(id: string, current: string, next: string): Promise<PasswordChange> {
  await migrate();
  if (next.length < MIN_PASSWORD) return { ok: false, reason: 'weak_password' };

  const rows = await query<{ password_hash: string }>('select password_hash from accounts where id = $1', [id]);
  const found = rows[0];
  if (!found || !(await passwordMatches(current, found.password_hash))) return { ok: false, reason: 'wrong' };

  // Checked after the current password, so this cannot be used to test
  // whether a password is breached without knowing the account's.
  const verdict = await judgePassword(next);
  if (!verdict.ok) return { ok: false, reason: 'breached', message: verdict.message };

  await query('update accounts set password_hash = $1 where id = $2', [await hashPassword(next), id]);
  // Every reset link outstanding for this account is now void: somebody who
  // knows the password has just proved it, and a link sitting in an old inbox
  // should not be able to undo that.
  await query('delete from resets where account_id = $1', [id]);
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Forgotten passwords
 * ------------------------------------------------------------------ */

/** Long enough to be worth clicking, short enough to be worth losing. */
const RESET_HOURS = 2;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('base64');

/**
 * Start a reset, and say nothing about whether the address exists.
 *
 * This always reports success. An endpoint that says "no such account" is a
 * tool for finding out who has one, and the people most interested in that
 * list are not the ones who forgot their password.
 */
export async function requestReset(email: string, link: (token: string) => string): Promise<void> {
  await migrate();
  const address = normaliseEmail(email);

  const rows = await query<{ id: string }>('select id from accounts where email = $1', [address]);
  const found = rows[0];
  if (!found) return;

  const token = randomBytes(32).toString('base64url');
  await query(
    `insert into resets (token_hash, account_id, expires_at) values ($1, $2, now() + interval '${RESET_HOURS} hours')`,
    [hashToken(token), found.id],
  );

  await sendMail({
    to: address,
    subject: 'Reset your Squish password',
    text: [
      'Somebody asked to reset the password on this Squish account.',
      '',
      link(token),
      '',
      `That link works for ${RESET_HOURS} hours and once only.`,
      'If it was not you, nothing has happened and you can ignore this.',
    ].join('\n'),
  });
}

export type ResetResult = { ok: true; accountId: string } | { ok: false; reason: 'bad_token' | 'weak_password' | 'breached'; message?: string };

/** Finish a reset. The token is spent whether or not it is used again. */
export async function completeReset(token: string, password: string): Promise<ResetResult> {
  await migrate();
  if (password.length < MIN_PASSWORD) return { ok: false, reason: 'weak_password' };

  const verdict = await judgePassword(password);
  if (!verdict.ok) return { ok: false, reason: 'breached', message: verdict.message };

  const passwordHash = await hashPassword(password);

  return await transaction(async (client) => {
    // Deleted as it is read, in one statement, so a link clicked twice at once
    // cannot set two passwords.
    const claimed = await client.query<{ account_id: string }>(
      'delete from resets where token_hash = $1 and expires_at > now() returning account_id',
      [hashToken(token)],
    );
    const row = claimed.rows[0];
    if (!row) return { ok: false as const, reason: 'bad_token' as const };

    await client.query('update accounts set password_hash = $1 where id = $2', [passwordHash, row.account_id]);
    await client.query('delete from resets where account_id = $1', [row.account_id]);
    // Every device, including whichever one is doing this. Somebody resetting
    // a password has either forgotten it or fears somebody else has it, and
    // in the second case the device tokens are exactly what needs cutting —
    // a new password does nothing to a credential that is not the password.
    await client.query('update devices set account_id = null where account_id = $1', [row.account_id]);
    return { ok: true as const, accountId: row.account_id };
  });
}

/** Housekeeping: expired links are of no use to anybody. */
export async function sweepResets(): Promise<void> {
  await migrate();
  await query('delete from resets where expires_at <= now()');
}
