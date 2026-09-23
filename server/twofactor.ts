/**
 * A second step for admins: a six-digit code from an authenticator app.
 *
 * The dashboard can hand out paid plans, read every account's address and
 * change what Squish emails people. A password alone guarding that means one
 * reused or phished password is the whole service, so admins also prove they
 * are holding their phone.
 *
 * Codes are TOTP (RFC 6238) — the scheme Google Authenticator, 1Password,
 * Authy and the iPhone's own Passwords app all speak — built on node's crypto
 * rather than a library, because it is thirty lines and those thirty lines are
 * the security boundary.
 *
 * The rules, and why:
 *
 *   - **Setting it up takes the password.** Otherwise anybody who found an
 *     admin's phone unlocked, before 2FA was on, could add their own app.
 *   - **A code works once.** The newest accepted 30-second window is recorded,
 *     so a code read over a shoulder cannot be replayed a moment later.
 *   - **Five wrong codes lock it for fifteen minutes.** A six-digit code is a
 *     million guesses; an attacker gets five every quarter of an hour. Counted
 *     per account, not per device, because devices are free to make.
 *   - **A pass lasts twelve hours, on one device.** Signing out or in again
 *     ends it.
 *   - **Ten recovery codes, each good once,** for a lost phone. Past those,
 *     `npm run reset-2fa -- <email>` from the server's shell — deliberately
 *     something only somebody with the hosting login can do.
 *
 * The app's secret is stored as-is rather than hashed, because the server has
 * to compute codes from it. That is the same bargain every TOTP service makes:
 * this protects against a stolen password or device, and somebody who can read
 * the database already has everything the dashboard would show them.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import qrcode from 'qrcode-generator';
import { migrate, query } from './db';

const STEP_SECONDS = 30;
const DIGITS = 6;
/** Codes from one window either side are accepted, for a phone's clock being a little out. */
const DRIFT = 1;
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const SESSION_HOURS = 12;
const RECOVERY_CODES = 10;
const ISSUER = 'Squish';

/* ---------------- The arithmetic ---------------- */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const number = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(number).padStart(DIGITS, '0');
}

const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The code an app holding this secret shows at this moment. */
export const codeAt = (secret: string, ms = Date.now()): string => hotp(fromBase32(secret), stepAt(ms));

/** Which window this code belongs to, or null if it matches none near now. */
function matchingStep(secret: string, code: string, ms: number): number | null {
  const key = fromBase32(secret);
  const given = Buffer.from(code);
  const now = stepAt(ms);
  let found: number | null = null;
  // Every candidate is compared, match or not, so how long this takes says
  // nothing about which window was right.
  for (let step = now - DRIFT; step <= now + DRIFT; step++) {
    const expected = Buffer.from(hotp(key, step));
    if (expected.length === given.length && timingSafeEqual(expected, given)) found ??= step;
  }
  return found;
}

/** Spaces and dashes are how people copy codes; neither is part of one. */
const tidy = (code: string) => code.replace(/[\s-]/g, '').toLowerCase();
const isAppCode = (code: string) => /^\d{6}$/.test(code);

/* ---------------- Recovery codes ---------------- */

// No 0/o, 1/l/i: these get written on paper and typed back in.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function recoveryCode(): string {
  let code = '';
  for (let i = 0; i < 10; i++) code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

const hashRecovery = (code: string) => createHash('sha256').update(tidy(code)).digest('hex');

async function issueRecoveryCodes(accountId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODES }, recoveryCode);
  await query('delete from admin_recovery_codes where account_id = $1', [accountId]);
  for (const code of codes) {
    await query('insert into admin_recovery_codes (account_id, code_hash) values ($1, $2)', [accountId, hashRecovery(code)]);
  }
  return codes;
}

async function recoveryLeft(accountId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    'select count(*) as n from admin_recovery_codes where account_id = $1 and used_at is null',
    [accountId],
  );
  return Number(rows[0]?.n ?? 0);
}

/* ---------------- State ---------------- */

interface Row extends Record<string, unknown> {
  secret: string;
  enabled_at: Date | null;
  locked_until: Date | null;
}

async function rowFor(accountId: string): Promise<Row | null> {
  const rows = await query<Row>('select secret, enabled_at, locked_until from admin_totp where account_id = $1', [
    accountId,
  ]);
  return rows[0] ?? null;
}

export interface TwoFactorState {
  enrolled: boolean;
  passed: boolean;
  until: string | null;
  recoveryLeft: number;
}

export async function stateFor(accountId: string, deviceId: string): Promise<TwoFactorState> {
  await migrate();
  const row = await rowFor(accountId);
  const enrolled = Boolean(row?.enabled_at);
  const session = enrolled ? await sessionUntil(accountId, deviceId) : null;
  return {
    enrolled,
    passed: Boolean(session),
    until: session?.toISOString() ?? null,
    recoveryLeft: enrolled ? await recoveryLeft(accountId) : 0,
  };
}

async function sessionUntil(accountId: string, deviceId: string): Promise<Date | null> {
  const rows = await query<{ until: Date }>(
    'select until from admin_sessions where device_id = $1 and account_id = $2 and until > now()',
    [deviceId, accountId],
  );
  return rows[0]?.until ?? null;
}

/** Whether this device has passed the second step, as this account, recently enough. */
export async function hasPassed(accountId: string, deviceId: string): Promise<boolean> {
  await migrate();
  const rows = await query(
    `select 1 from admin_sessions s join admin_totp t on t.account_id = s.account_id
      where s.device_id = $1 and s.account_id = $2 and s.until > now() and t.enabled_at is not null`,
    [deviceId, accountId],
  );
  return rows.length > 0;
}

async function openSession(accountId: string, deviceId: string): Promise<void> {
  await query(
    `insert into admin_sessions (device_id, account_id, until)
     values ($1, $2, now() + make_interval(hours => $3))
     on conflict (device_id) do update set account_id = excluded.account_id, until = excluded.until`,
    [deviceId, accountId, SESSION_HOURS],
  );
}

/** Lock the dashboard on this device now, rather than in twelve hours. */
export async function endSession(deviceId: string): Promise<void> {
  await migrate();
  await query('delete from admin_sessions where device_id = $1', [deviceId]);
}

/* ---------------- Failures ---------------- */

const lockedFor = (row: Row): number | null => {
  const until = row.locked_until?.getTime() ?? 0;
  return until > Date.now() ? Math.ceil((until - Date.now()) / 60_000) : null;
};

/** One more wrong code; the fifth locks the account and starts the count again. */
async function fail(accountId: string): Promise<void> {
  await query(
    `update admin_totp
        set failures     = case when failures + 1 >= $2 then 0 else failures + 1 end,
            locked_until = case when failures + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
      where account_id = $1`,
    [accountId, MAX_FAILURES, LOCK_MINUTES],
  );
}

/* ---------------- Setting up ---------------- */

export interface Setup {
  secret: string;
  uri: string;
  /** An SVG of the QR code, as a data URL an <img> can show. */
  qr: string;
}

/**
 * A fresh secret for the admin's app, not yet switched on.
 *
 * Asking again replaces an unfinished one, so a QR code that was never
 * scanned is not a dead end. Null once 2FA is on: changing the app on an
 * enrolled account is a reset from the server's shell, not something a signed-in
 * device can do.
 */
export async function beginSetup(accountId: string, email: string): Promise<Setup | null> {
  await migrate();
  const existing = await rowFor(accountId);
  if (existing?.enabled_at) return null;

  const secret = toBase32(randomBytes(20));
  await query(
    `insert into admin_totp (account_id, secret) values ($1, $2)
     on conflict (account_id) do update set secret = excluded.secret, last_step = 0
      where admin_totp.enabled_at is null`,
    [accountId, secret],
  );

  const label = encodeURIComponent(`${ISSUER}:${email}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  const code = qrcode(0, 'M');
  code.addData(uri);
  code.make();
  const svg = code.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  return { secret, uri, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
}

export type Checked =
  | { ok: true; recoveryLeft: number; usedRecovery: boolean; recoveryCodes?: string[] }
  | { ok: false; reason: 'wrong' | 'locked' | 'not_started' | 'already_on' | 'not_on'; minutes?: number };

/**
 * Switch 2FA on, with a code proving the app has the secret. The caller has
 * already checked the password. Returns the recovery codes — the only time
 * they exist anywhere but hashed.
 */
export async function finishSetup(accountId: string, deviceId: string, code: string, ms = Date.now()): Promise<Checked> {
  await migrate();
  const row = await rowFor(accountId);
  if (!row) return { ok: false, reason: 'not_started' };
  if (row.enabled_at) return { ok: false, reason: 'already_on' };
  const minutes = lockedFor(row);
  if (minutes) return { ok: false, reason: 'locked', minutes };

  const given = tidy(code);
  const step = isAppCode(given) ? matchingStep(row.secret, given, ms) : null;
  if (step === null) {
    await fail(accountId);
    return { ok: false, reason: 'wrong' };
  }

  const switched = await query(
    `update admin_totp set enabled_at = now(), last_step = $2, failures = 0, locked_until = null
      where account_id = $1 and enabled_at is null returning 1`,
    [accountId, step],
  );
  if (switched.length === 0) return { ok: false, reason: 'already_on' };

  const recoveryCodes = await issueRecoveryCodes(accountId);
  await openSession(accountId, deviceId);
  return { ok: true, recoveryLeft: recoveryCodes.length, usedRecovery: false, recoveryCodes };
}

/* ---------------- Every visit after ---------------- */

/** A code from the app, or a recovery code, to open the dashboard on this device. */
export async function checkCode(accountId: string, deviceId: string, code: string, ms = Date.now()): Promise<Checked> {
  await migrate();
  const row = await rowFor(accountId);
  if (!row?.enabled_at) return { ok: false, reason: 'not_on' };
  const minutes = lockedFor(row);
  if (minutes) return { ok: false, reason: 'locked', minutes };

  const given = tidy(code);
  let usedRecovery = false;

  if (isAppCode(given)) {
    const step = matchingStep(row.secret, given, ms);
    // Only a window newer than the last one accepted counts. Done in the
    // update itself, so two requests racing with the same code cannot both win.
    const accepted =
      step !== null &&
      (
        await query('update admin_totp set last_step = $2, failures = 0 where account_id = $1 and last_step < $2 returning 1', [
          accountId,
          step,
        ])
      ).length > 0;
    if (!accepted) {
      await fail(accountId);
      return { ok: false, reason: 'wrong' };
    }
  } else {
    const spent = await query(
      `update admin_recovery_codes set used_at = now()
        where account_id = $1 and code_hash = $2 and used_at is null returning 1`,
      [accountId, hashRecovery(given)],
    );
    if (spent.length === 0) {
      await fail(accountId);
      return { ok: false, reason: 'wrong' };
    }
    await query('update admin_totp set failures = 0 where account_id = $1', [accountId]);
    usedRecovery = true;
  }

  await openSession(accountId, deviceId);
  return { ok: true, recoveryLeft: await recoveryLeft(accountId), usedRecovery };
}

/** A fresh set of ten, replacing whatever was left of the old ones. */
export async function replaceRecoveryCodes(accountId: string): Promise<string[]> {
  await migrate();
  return issueRecoveryCodes(accountId);
}

/** For a lost phone with no recovery codes left. Run from the server, never from the app. */
export async function resetTwoFactor(accountId: string): Promise<void> {
  await migrate();
  await query('delete from admin_sessions where account_id = $1', [accountId]);
  await query('delete from admin_recovery_codes where account_id = $1', [accountId]);
  await query('delete from admin_totp where account_id = $1', [accountId]);
}
