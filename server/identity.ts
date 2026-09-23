/**
 * Who is asking.
 *
 * Not a person — a device. A browser or a phone gets an opaque token the first
 * time it opens Squish, keeps it, and sends it with everything after. No
 * sign-up, no email, nothing for anybody to do, and it is the difference
 * between a rate limit that means something and one that does not.
 *
 * The one it replaces counted requests per IP address in memory. Everybody on
 * the same mobile network shares an address, so one enthusiastic user could
 * lock out a whole carrier, and a restart forgave everybody at once. A device
 * is the thing you actually want to count.
 *
 * A token is a bearer credential — whoever holds it is that device — so it is
 * stored hashed, the way a password is. Unlike a password it is 32 random
 * bytes rather than something a person chose, so a single SHA-256 is enough:
 * there is nothing to guess and no dictionary to try.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hasDatabase, migrate, query } from './db';

export interface Device {
  id: string;
  accountId: string | null;
}

const hash = (token: string): string => createHash('sha256').update(token).digest('base64');

/** Opaque, url-safe, and long enough that guessing is not a strategy. */
const mint = (): string => randomBytes(32).toString('base64url');

export interface NewDevice {
  id: string;
  token: string;
}

/** Called once, by a browser that has never been here before. */
export async function registerDevice(): Promise<NewDevice> {
  await migrate();
  const id = randomBytes(9).toString('base64url');
  const token = mint();
  await query('insert into devices (id, token_hash) values ($1, $2)', [id, hash(token)]);
  return { id, token };
}

/**
 * The device this token belongs to, or null.
 *
 * Null covers three cases that look the same from here and should: a token
 * that was never real, one from a database that has since been replaced, and
 * a device somebody deleted. In all three the client's answer is the same —
 * register again — so they are not distinguished.
 */
export async function deviceFor(token: string | undefined): Promise<Device | null> {
  if (!token || !hasDatabase()) return null;
  await migrate();

  const rows = await query<{ id: string; account_id: string | null }>(
    'select id, account_id from devices where token_hash = $1',
    [hash(token)],
  );
  const found = rows[0];
  if (!found) return null;

  // Not awaited: the timestamp is for working out how many people still use
  // Squish, and nobody's request should wait on it.
  void query('update devices set last_seen_at = now() where id = $1', [found.id]).catch(() => {});
  return { id: found.id, accountId: found.account_id };
}

/** Constant-time comparison, for anywhere a secret is checked against input. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------ *
 * What a device has spent
 * ------------------------------------------------------------------ */

/**
 * `signin`, `reset` and `invite` are counted for a different reason from the
 * rest.
 *
 * The others are an allowance: somebody has used their photos for today. These
 * these are a brake on guessing — a password, or an invite code that is worth
 * money to whoever finds one.
 */
export type Spend = 'photo' | 'chat' | 'recipe' | 'signin' | 'reset' | 'invite' | 'verify';

/**
 * Count one, and say how many have been counted today.
 *
 * One statement rather than a read and a write, because two devices asking at
 * once would otherwise both read four and both write five. The count comes
 * back from the same statement that incremented it, so what the caller
 * compares against a limit is what was actually recorded.
 */
export async function spend(deviceId: string, kind: Spend): Promise<number> {
  const rows = await query<{ count: number }>(
    `insert into usage (device_id, day, kind, count) values ($1, current_date, $2, 1)
     on conflict (device_id, day, kind) do update set count = usage.count + 1
     returning count`,
    [deviceId, kind],
  );
  return rows[0]?.count ?? 1;
}

/** What has been spent today, without spending any more. */
export async function spentToday(deviceId: string, kind: Spend): Promise<number> {
  const rows = await query<{ count: number }>(
    'select count from usage where device_id = $1 and day = current_date and kind = $2',
    [deviceId, kind],
  );
  return rows[0]?.count ?? 0;
}

/**
 * Record what a call actually cost, once it is known.
 *
 * Separate from `spend` because the two happen at different moments: the
 * count has to go up before the call, so an allowance cannot be overrun by
 * firing ten at once, and the price is only known after it comes back.
 *
 * Never awaited by anything the person is waiting on, and never allowed to
 * fail a request. A missing price is a gap in a report; a failed analysis
 * because the bookkeeping fell over would be somebody's lunch.
 */
export async function recordCost(deviceId: string, kind: Spend, usd: number | null): Promise<void> {
  if (!usd || !Number.isFinite(usd) || usd <= 0) return;
  await query(
    `update usage set cost_usd = cost_usd + $3
      where device_id = $1 and day = current_date and kind = $2`,
    [deviceId, kind, usd.toFixed(6)],
  );
}
