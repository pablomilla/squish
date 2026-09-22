/**
 * Invite codes: giving somebody Plus without them paying.
 *
 * For testers, press, goodwill after something went wrong, and anybody else
 * who should have the paid tier without a card. The codes live in an
 * environment variable rather than a table, which is the whole point of them:
 * handing Plus to a tester becomes editing one field in a dashboard, where
 * the alternative was opening a shell and running a script against the
 * production database.
 *
 * That is also why this is a route when granting deliberately is not. A route
 * that hands out paid access to anybody who asks is a route somebody will
 * find; a route that hands it to whoever holds an unguessable string is a
 * coupon, which is how every shop has worked for a century. What keeps it
 * honest is that the string is long, wrong guesses are counted, and revoking
 * is a one-field edit.
 *
 *   SQUISH_INVITE_CODES=SQUISH-TESTER-7F3K        one code
 *   SQUISH_INVITE_CODES=EARLY-BIRD,PRESS-2026     several
 *   SQUISH_INVITE_DAYS=365                        how long each is worth
 *
 * Unset means no codes exist and every attempt is refused, which is the right
 * default: a Squish that was never given any should not have a back door.
 */
import { query, transaction } from './db';

/** Typed by a person, so compared the way a person would: loosely. */
const tidy = (code: string): string => code.trim().toUpperCase().replace(/\s+/g, '');

export function inviteCodes(): string[] {
  return (process.env.SQUISH_INVITE_CODES ?? '')
    .split(',')
    .map(tidy)
    .filter(Boolean);
}

/** How long a code is worth. A year, unless somebody says otherwise. */
export function inviteDays(): number {
  const raw = Number(process.env.SQUISH_INVITE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 365;
}

export const invitesExist = (): boolean => inviteCodes().length > 0;

export type Redemption =
  | { ok: true; days: number; until: string }
  | { ok: false; reason: 'unknown' | 'already' };

/**
 * Redeem a code against an account.
 *
 * The time is added to whatever is there rather than replacing it, so a code
 * given to somebody already paying extends them rather than cutting them
 * short — and `greatest(plus_until, now())` means a lapsed account starts
 * from today instead of from whenever it ran out.
 *
 * One code per account, enforced by the primary key rather than by checking
 * first, so two taps on a slow connection cannot buy two years.
 */
export async function redeem(accountId: string, code: string): Promise<Redemption> {
  const wanted = tidy(code);
  if (!wanted || !inviteCodes().includes(wanted)) return { ok: false, reason: 'unknown' };

  const days = inviteDays();

  try {
    return await transaction(async (client) => {
      await client.query('insert into invite_uses (code, account_id, days) values ($1, $2, $3)', [wanted, accountId, days]);

      const rows = await client.query<{ plus_until: Date }>(
        `update accounts
            set plus_until = greatest(coalesce(plus_until, now()), now()) + ($2 || ' days')::interval
          where id = $1
        returning plus_until`,
        [accountId, String(days)],
      );

      return { ok: true as const, days, until: rows.rows[0].plus_until.toISOString() };
    });
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') return { ok: false, reason: 'already' };
    throw error;
  }
}

/** Who has used what, for seeing whether anybody took it up. */
export async function redemptions(): Promise<{ code: string; email: string; days: number; usedAt: Date }[]> {
  const rows = await query<{ code: string; email: string; days: number; used_at: Date }>(
    `select i.code, a.email, i.days, i.used_at
       from invite_uses i join accounts a on a.id = i.account_id
      order by i.used_at desc`,
  );
  return rows.map((row) => ({ code: row.code, email: row.email, days: row.days, usedAt: row.used_at }));
}
