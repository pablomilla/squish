/**
 * Confirming that an address belongs to whoever typed it.
 *
 * Soft on purpose. Nothing in Squish is withheld from an unconfirmed account:
 * the diary, the backup, the tiers all work the same. What confirmation gates
 * is Squish *sending mail about you* — the security notices go only to a
 * confirmed address, because otherwise anybody could sign up as a stranger and
 * have this app email them about an account they never made.
 *
 * And none of it is shown while this deployment cannot send mail. Asking
 * somebody to click a link in an email that will never arrive is worse than
 * not asking.
 */
import { createHash, randomBytes } from 'node:crypto';
import { migrate, query } from './db';
import { sendMail } from './mail';

/** A week: long enough to get round to it, short enough to be worth losing. */
const DAYS = 7;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('base64');

export async function isVerified(accountId: string): Promise<boolean> {
  await migrate();
  const rows = await query<{ verified: boolean }>(
    'select email_verified_at is not null as verified from accounts where id = $1',
    [accountId],
  );
  return Boolean(rows[0]?.verified);
}

/**
 * Send a link that confirms the address. Does nothing if it already is.
 *
 * Throws if the mail provider refuses, so the person asking to resend can be
 * told it did not go — unlike a security notice, this is something somebody
 * is waiting for.
 */
export async function sendVerification(accountId: string, link: (token: string) => string): Promise<'sent' | 'already'> {
  await migrate();
  const rows = await query<{ email: string; verified: boolean }>(
    'select email, email_verified_at is not null as verified from accounts where id = $1',
    [accountId],
  );
  const account = rows[0];
  if (!account) throw new Error('no such account');
  if (account.verified) return 'already';

  const token = randomBytes(32).toString('base64url');
  await query(
    `insert into verifications (token_hash, account_id, expires_at) values ($1, $2, now() + interval '${DAYS} days')`,
    [hashToken(token), accountId],
  );

  await sendMail({
    to: account.email,
    subject: 'Confirm your email for Squish',
    text: [
      'Somebody — hopefully you — made a Squish account with this address.',
      '',
      'To confirm it is yours:',
      link(token),
      '',
      `That link works for ${DAYS} days.`,
      "If you did not make an account, you can ignore this. Nothing will be sent to you again unless somebody follows the link.",
    ].join('\n'),
  });
  return 'sent';
}

export type Confirmation = { ok: true; email: string } | { ok: false };

/**
 * Follow a link.
 *
 * Idempotent. The token is kept until it expires rather than spent on first
 * use, because mail scanners follow links before people do — and the person
 * clicking theirs after Outlook got there first should be told it worked.
 */
export async function confirm(token: string): Promise<Confirmation> {
  await migrate();
  const rows = await query<{ email: string }>(
    `update accounts a
        set email_verified_at = coalesce(a.email_verified_at, now())
       from verifications v
      where v.token_hash = $1
        and v.expires_at > now()
        and v.account_id = a.id
    returning a.email`,
    [hashToken(token)],
  );
  return rows[0] ? { ok: true, email: rows[0].email } : { ok: false };
}

export async function sweepVerifications(): Promise<void> {
  await migrate();
  await query('delete from verifications where expires_at <= now()');
}
