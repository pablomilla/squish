/**
 * Fair use: what keeps an unlimited Plus unlimited for the people it is for.
 *
 * Plus's AI is unlimited for one person's own eating, with a ceiling a day
 * far past anything a person eats (server/plan.ts). This is the rest:
 *
 * - **A speed limit.** No person analyses ten meals in a minute; a script
 *   does at once. Counted here, in memory, per person — approximate across
 *   instances, which is fine for telling a person from a program.
 * - **One person per account.** At most five devices signed in at once; a
 *   sixth signing in signs out the one used longest ago, rather than being
 *   refused — a new phone should never be locked out by an old one.
 * - **A record of the days somebody reached a ceiling**, so the dashboard
 *   can show who does it often. Nothing is done about it automatically:
 *   a person decides.
 *
 * None of this ever charges anybody or stops their account: under the UK's
 * advertising rules an "unlimited" plan may manage use only well past what a
 * legitimate user does, and must say how — docs/monetisation.md, "Fair use".
 */
import type { PoolClient } from 'pg';
import { hasDatabase, query } from './db';
import type { Billable } from './plan';

const setting = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};

/** How many of each a person may start in a minute. 0 turns a limit off. */
export const PER_MINUTE: Record<Billable, number> = {
  photo: setting('SQUISH_PHOTOS_A_MINUTE', 10),
  chat: setting('SQUISH_CHATS_A_MINUTE', 15),
  recipe: setting('SQUISH_RECIPES_A_MINUTE', 5),
};

/** Devices signed in to one account at once. */
export const MAX_DEVICES = setting('SQUISH_MAX_DEVICES', 5);

/** Days in a month at a ceiling before the dashboard points somebody out. */
export const FLAG_DAYS = setting('SQUISH_FAIR_USE_FLAG_DAYS', 3);

const MINUTE_MS = 60_000;
const recent = new Map<string, number[]>();

/**
 * Whether this person may start another of these now: true, and counted, if
 * fewer than the limit were started in the last minute. Per person, so two
 * devices on one account share it.
 */
export function withinSpeed(owner: string, kind: Billable, now = Date.now()): boolean {
  const limit = PER_MINUTE[kind];
  if (!limit) return true;
  const key = `${owner}:${kind}`;
  const kept = (recent.get(key) ?? []).filter((at) => now - at < MINUTE_MS);
  if (kept.length >= limit) {
    recent.set(key, kept);
    return false;
  }
  kept.push(now);
  recent.set(key, kept);
  // Forgotten as they age, so a long-running server does not keep everybody who ever asked.
  if (recent.size > 20_000) {
    for (const [name, times] of recent) if (!times.some((at) => now - at < MINUTE_MS)) recent.delete(name);
  }
  return true;
}

/** For the tests: as if no minute had passed. */
export const forgetSpeed = (): void => recent.clear();

/** How long the days at a ceiling are kept: this month and the two before, and then let go. */
export const KEEP_DAYS = 92;

/** Somebody reached a daily ceiling, or the speed limit: noted once a day a kind. */
export async function noteCeiling(owner: string, kind: Billable | `${Billable}-speed`): Promise<void> {
  if (!hasDatabase()) return;
  await query('insert into fair_use_hits (owner_id, kind) values ($1, $2) on conflict do nothing', [owner, kind]);
  // Older ones let go as new ones arrive: rare, and an index on the day makes it cheap.
  await query(`delete from fair_use_hits where day < current_date - $1::int`, [KEEP_DAYS]);
}

/** How many different days this month each owner reached a ceiling, for those at FLAG_DAYS or more. */
export async function flaggedThisMonth(): Promise<Map<string, number>> {
  if (!hasDatabase()) return new Map();
  const rows = await query<{ owner_id: string; days: number }>(
    `select owner_id, count(distinct day)::int as days from fair_use_hits
      where day >= date_trunc('month', current_date)
      group by owner_id having count(distinct day) >= $1`,
    [FLAG_DAYS],
  );
  return new Map(rows.map((row) => [row.owner_id, row.days]));
}

/**
 * After a device signs in to an account: past MAX_DEVICES, the ones used
 * longest ago are signed out — detached, as signing out everywhere does, so
 * they go on working as devices of their own. The one signing in is always
 * kept. Answers how many were signed out.
 */
export async function keepNewestDevices(client: PoolClient, accountId: string, signingIn: string): Promise<number> {
  if (!MAX_DEVICES) return 0;
  const out = await client.query<{ id: string }>(
    `update devices set account_id = null
      where account_id = $1 and id in (
        select id from devices where account_id = $1
         order by (id = $2) desc, last_seen_at desc, created_at desc
        offset $3)
      returning id`,
    [accountId, signingIn, MAX_DEVICES],
  );
  const gone = out.rows.map((row) => row.id);
  if (gone.length) await client.query('delete from admin_sessions where device_id = any($1)', [gone]);
  return gone.length;
}
