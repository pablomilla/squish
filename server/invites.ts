/**
 * Invite codes: giving somebody Plus without them paying.
 *
 * For testers, press, goodwill after something went wrong, and anybody else
 * who should have the paid tier without a card.
 *
 * These lived in an environment variable for about a day, which was already
 * better than running a script against the production database — but it meant
 * every change was a deploy, and a code could not know how many people had
 * used it or when it should stop working. They live in the database now and
 * are made and retired from the dashboard, which is the only place they
 * exist: two sources of truth for "is this code still good" is how you end up
 * deleting one and finding it still works.
 *
 * A code is a credential handed out deliberately, which is how every shop has
 * worked for a century. What keeps it honest is that the string is long
 * enough not to be guessed, that wrong guesses are counted against the device,
 * and that switching one off takes effect at once.
 */
import { query, transaction } from './db';

/** Typed by a person, so compared the way a person types: loosely. */
export const tidy = (code: string): string => code.trim().toUpperCase().replace(/\s+/g, '');

/**
 * Letters and digits that cannot be misread for one another.
 *
 * No O or 0, no I or 1, because these get read down a phone and written on
 * the back of things. Four groups of four is 20 bits a group — comfortably
 * unguessable at ten tries a day, and still short enough to say aloud.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function suggestCode(prefix = 'SQUISH'): string {
  const pick = () =>
    Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  return `${tidy(prefix)}-${pick()}-${pick()}`;
}

export interface Invite {
  code: string;
  days: number;
  usesLeft: number | null;
  note: string | null;
  expiresAt: string | null;
  disabled: boolean;
  used: number;
  createdAt: string;
}

/** Every code, with how many people have taken each one up. */
export async function listInvites(): Promise<Invite[]> {
  const rows = await query<{
    code: string;
    days: number;
    uses_left: number | null;
    note: string | null;
    expires_at: Date | null;
    disabled: boolean;
    created_at: Date;
    used: string;
  }>(
    `select i.*, (select count(*) from invite_uses u where u.code = i.code)::text as used
       from invites i
      order by i.created_at desc`,
  );

  return rows.map((row) => ({
    code: row.code,
    days: row.days,
    usesLeft: row.uses_left,
    note: row.note,
    expiresAt: row.expires_at?.toISOString() ?? null,
    disabled: row.disabled,
    used: Number(row.used),
    createdAt: row.created_at.toISOString(),
  }));
}

/** Whether any code is currently worth offering a box for. */
export async function invitesExist(): Promise<boolean> {
  const rows = await query<{ any: number }>(
    `select 1 as any from invites
      where not disabled
        and (uses_left is null or uses_left > 0)
        and (expires_at is null or expires_at > now())
      limit 1`,
  );
  return rows.length > 0;
}

export type MadeInvite = { ok: true; invite: Invite } | { ok: false; reason: 'taken' | 'bad_code' | 'bad_days' };

export async function createInvite(
  by: string,
  input: { code: string; days: number; uses: number | null; note: string | null },
): Promise<MadeInvite> {
  const code = tidy(input.code);
  // Short enough to guess is not a code. Ten tries a day against six
  // characters is still a bad bet, but it is not a bet worth offering.
  if (code.length < 8 || code.length > 64 || !/^[A-Z0-9-]+$/.test(code)) return { ok: false, reason: 'bad_code' };
  if (!Number.isFinite(input.days) || input.days < 1 || input.days > 3650) return { ok: false, reason: 'bad_days' };

  try {
    await query('insert into invites (code, days, uses_left, note, created_by) values ($1, $2, $3, $4, $5)', [
      code,
      Math.round(input.days),
      input.uses === null ? null : Math.max(1, Math.round(input.uses)),
      input.note?.trim() || null,
      by,
    ]);
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') return { ok: false, reason: 'taken' };
    throw error;
  }

  const made = (await listInvites()).find((invite) => invite.code === code)!;
  return { ok: true, invite: made };
}

/** Switch one off or back on. Off takes effect on the next attempt. */
export async function setInviteDisabled(code: string, disabled: boolean): Promise<boolean> {
  const rows = await query<{ code: string }>('update invites set disabled = $2 where code = $1 returning code', [
    tidy(code),
    disabled,
  ]);
  return rows.length > 0;
}

/**
 * Remove one entirely.
 *
 * The redemptions stay. Somebody who is on Plus because of this code keeps
 * it — deleting a coupon is not a way to take back what it bought — and the
 * record of who used it is worth more than the row it referred to.
 */
export async function deleteInvite(code: string): Promise<boolean> {
  const rows = await query<{ code: string }>('delete from invites where code = $1 returning code', [tidy(code)]);
  return rows.length > 0;
}

export type Redemption =
  | { ok: true; days: number; until: string }
  | { ok: false; reason: 'unknown' | 'already' | 'spent' };

/**
 * Redeem a code against an account.
 *
 * The time is added to whatever is there rather than replacing it, so a code
 * given to somebody already paying extends them rather than cutting them
 * short — and `greatest(plus_until, now())` means a lapsed account starts
 * from today instead of from whenever it ran out.
 *
 * One code per account, enforced by the primary key on `invite_uses` rather
 * than by checking first, so two taps on a slow connection cannot buy two
 * years. The remaining-uses count comes down in the same transaction, with
 * the row locked, so a code limited to twenty cannot serve twenty-five people
 * who all tapped at once.
 */
export async function redeem(accountId: string, code: string): Promise<Redemption> {
  const wanted = tidy(code);
  if (!wanted) return { ok: false, reason: 'unknown' };

  try {
    return await transaction(async (client) => {
      const found = await client.query<{ days: number; uses_left: number | null }>(
        `select days, uses_left from invites
          where code = $1
            and not disabled
            and (expires_at is null or expires_at > now())
          for update`,
        [wanted],
      );
      const invite = found.rows[0];
      if (!invite) return { ok: false as const, reason: 'unknown' as const };
      if (invite.uses_left !== null && invite.uses_left <= 0) return { ok: false as const, reason: 'spent' as const };

      await client.query('insert into invite_uses (code, account_id, days) values ($1, $2, $3)', [
        wanted,
        accountId,
        invite.days,
      ]);
      await client.query('update invites set uses_left = uses_left - 1 where code = $1 and uses_left is not null', [
        wanted,
      ]);

      const rows = await client.query<{ plus_until: Date }>(
        `update accounts
            set plus_until = greatest(coalesce(plus_until, now()), now()) + ($2 || ' days')::interval
          where id = $1
        returning plus_until`,
        [accountId, String(invite.days)],
      );

      return { ok: true as const, days: invite.days, until: rows.rows[0].plus_until.toISOString() };
    });
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') return { ok: false, reason: 'already' };
    throw error;
  }
}

/** Who has used what, for seeing whether anybody took it up. */
export async function redemptions(limit = 50): Promise<{ code: string; email: string; days: number; usedAt: string }[]> {
  const rows = await query<{ code: string; email: string; days: number; used_at: Date }>(
    `select i.code, a.email, i.days, i.used_at
       from invite_uses i join accounts a on a.id = i.account_id
      order by i.used_at desc
      limit $1`,
    [limit],
  );
  return rows.map((row) => ({ code: row.code, email: row.email, days: row.days, usedAt: row.used_at.toISOString() }));
}
