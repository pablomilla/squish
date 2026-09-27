/**
 * Changing the email address on an account.
 *
 * Three emails and three rules, all about not handing an account to the wrong
 * person:
 *
 *   1. The password is asked for, so a phone left unlocked cannot move the
 *      account somewhere its owner will never see.
 *   2. The new address has to be proved, by a link sent to it, before anything
 *      changes — and the link opens a page with a button rather than acting by
 *      itself, because mail scanners open links, and a scanner at a mistyped
 *      address must not be able to complete the move.
 *   3. The old address is told, with a way back. Whoever changed the address
 *      knew the password, so putting the address back is not enough: the way
 *      back also signs out every device, locks the password and sends a reset
 *      link to the address that was restored.
 *
 * An address that already has an account is never confirmed as one: the
 * person asking is told the same as always ("check that inbox"), and the
 * inbox gets a note saying so instead of a link.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { migrate, query, transaction } from './db';
import { canSendMail, sendMail, sendQuietly } from './mail';
import { compose, originOf } from './emails';
import { readerOf, type Reader } from './reader';
import { looksLikeEmail, lockPassword, normaliseEmail, requestReset, verifyPassword } from './accounts';
import { sendVerification } from './verify';
import { when } from './notices';

/** A day: time to get to the other inbox, not long enough to be worth stealing. */
export const CHANGE_HOURS = 24;
/** A week: long enough to notice an email about an account you have not opened lately. */
export const UNDO_DAYS = 7;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('base64');
const newToken = (): string => randomBytes(32).toString('base64url');

/**
 * The way back, for an old address that was the owner's (confirmed) — never
 * for an address nobody proved, which could be a stranger's. The token.
 */
async function leaveWayBack(client: PoolClient, accountId: string, oldEmail: string): Promise<string> {
  const undo = newToken();
  await client.query(
    `insert into email_undos (token_hash, account_id, old_email, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))`,
    [hashToken(undo), accountId, oldEmail, UNDO_DAYS],
  );
  return undo;
}

/** The old address hears about the move, with the way back. */
async function tellOldAddress(accountId: string, oldEmail: string, newEmail: string, undoUrl: string, origin: string): Promise<void> {
  const reader = await readerOf(accountId);
  sendQuietly(
    await compose(
      'email-changed',
      oldEmail,
      (words) => ({ new_email: newEmail, time: when(reader, words), undo_link: undoUrl, days: String(UNDO_DAYS) }),
      origin,
      reader,
    ),
    'email changed notice',
  );
}

export type ChangeRequest = { ok: true; to: string } | { ok: false; reason: 'wrong' | 'bad_email' | 'same' };

/**
 * Ask to move an account to a new address. The answer is the same whether or
 * not the address is free; what goes to that inbox is what differs.
 */
export async function requestEmailChange(
  accountId: string,
  password: string,
  rawEmail: string,
  link: (token: string) => string,
  said: Partial<Reader> = {},
): Promise<ChangeRequest> {
  await migrate();
  if (!(await verifyPassword(accountId, password))) return { ok: false, reason: 'wrong' };
  const email = normaliseEmail(rawEmail);
  if (!looksLikeEmail(email)) return { ok: false, reason: 'bad_email' };

  const current = (await query<{ email: string }>('select email from accounts where id = $1', [accountId]))[0];
  if (!current) return { ok: false, reason: 'wrong' };
  if (current.email === email) return { ok: false, reason: 'same' };

  const reader = await readerOf(accountId, said);
  const taken = (await query('select 1 from accounts where email = $1', [email])).length > 0;
  if (taken) {
    await sendMail(await compose('email-change-taken', email, {}, originOf(link('x')), reader));
    return { ok: true, to: email };
  }

  // One change waiting at a time: a new request replaces an older one.
  const token = newToken();
  await query('delete from email_changes where account_id = $1', [accountId]);
  await query(
    `insert into email_changes (token_hash, account_id, new_email, expires_at) values ($1, $2, $3, now() + make_interval(hours => $4))`,
    [hashToken(token), accountId, email, CHANGE_HOURS],
  );
  const url = link(token);
  await sendMail(await compose('email-change', email, { link: url, hours: String(CHANGE_HOURS) }, originOf(url), reader));
  return { ok: true, to: email };
}

export type ChangeLink = { ok: true; accountId: string; email: string; done: boolean } | { ok: false };

/** What a confirmation link is for, without doing it: for the page with the button. */
export async function peekEmailChange(token: string): Promise<ChangeLink> {
  await migrate();
  const row = (
    await query<{ account_id: string; new_email: string; current: string }>(
      `select c.account_id, c.new_email, a.email as current
         from email_changes c join accounts a on a.id = c.account_id
        where c.token_hash = $1 and c.expires_at > now()`,
      [hashToken(token)],
    )
  )[0];
  return row ? { ok: true, accountId: row.account_id, email: row.new_email, done: row.current === row.new_email } : { ok: false };
}

export type Confirmed = { ok: true; accountId: string; email: string } | { ok: false; reason: 'expired' | 'taken' };

/**
 * Make the change: the button on the confirmation page. Pressing it twice is
 * fine — the second time finds the account already moved and says so.
 */
export async function confirmEmailChange(token: string, undoLink: (token: string) => string, origin: string): Promise<Confirmed> {
  await migrate();
  const done = await transaction(async (client) => {
    const row = (
      await client.query<{ account_id: string; new_email: string }>(
        'select account_id, new_email from email_changes where token_hash = $1 and expires_at > now() for update',
        [hashToken(token)],
      )
    ).rows[0];
    if (!row) return { ok: false as const, reason: 'expired' as const };
    const account = (
      await client.query<{ email: string; verified: boolean }>(
        'select email, email_verified_at is not null as verified from accounts where id = $1 for update',
        [row.account_id],
      )
    ).rows[0];
    if (!account) return { ok: false as const, reason: 'expired' as const };
    if (account.email === row.new_email) return { ok: true as const, accountId: row.account_id, email: row.new_email, old: null };

    // Somebody else may have made an account with it since the link was sent.
    const clash = await client.query('select 1 from accounts where email = $1 and id <> $2', [row.new_email, row.account_id]);
    if (clash.rows.length) return { ok: false as const, reason: 'taken' as const };

    // Following the link proved the new inbox, so the new address is confirmed.
    await client.query('update accounts set email = $2, email_verified_at = now() where id = $1', [row.account_id, row.new_email]);
    // Links sent to the old address stop working: a reset link in an inbox
    // that is no longer the account's must not be a way back in.
    await client.query('delete from resets where account_id = $1', [row.account_id]);
    await client.query('delete from verifications where account_id = $1', [row.account_id]);
    await client.query('delete from email_changes where account_id = $1 and token_hash <> $2', [row.account_id, hashToken(token)]);

    const undo = account.verified ? await leaveWayBack(client, row.account_id, account.email) : null;
    return { ok: true as const, accountId: row.account_id, email: row.new_email, old: undo ? { email: account.email, undo } : null };
  });

  if (done.ok && done.old) await tellOldAddress(done.accountId, done.old.email, done.email, undoLink(done.old.undo), origin);
  return done.ok ? { ok: true, accountId: done.accountId, email: done.email } : done;
}

export type UndoLink = { ok: true; accountId: string; email: string } | { ok: false };

/** What an undo link would put back, without doing it: for the page with the button. */
export async function peekEmailUndo(token: string): Promise<UndoLink> {
  await migrate();
  const row = (
    await query<{ account_id: string; old_email: string }>(
      'select account_id, old_email from email_undos where token_hash = $1 and expires_at > now()',
      [hashToken(token)],
    )
  )[0];
  return row ? { ok: true, accountId: row.account_id, email: row.old_email } : { ok: false };
}

export type Undone = { ok: true; accountId: string; email: string; signedOut: number } | { ok: false; reason: 'expired' | 'taken' };

/**
 * Put the old address back: the button on the undo page. Assumes the worst —
 * that whoever moved the account knows its password — so every device is
 * signed out, the password is locked, and a reset link goes to the restored
 * address, which is the only way back in.
 */
export async function undoEmailChange(token: string, resetLink: (token: string) => string): Promise<Undone> {
  await migrate();
  const done = await transaction(async (client) => {
    const row = (
      await client.query<{ account_id: string; old_email: string }>(
        'select account_id, old_email from email_undos where token_hash = $1 and expires_at > now() for update',
        [hashToken(token)],
      )
    ).rows[0];
    if (!row) return { ok: false as const, reason: 'expired' as const };
    const clash = await client.query('select 1 from accounts where email = $1 and id <> $2', [row.old_email, row.account_id]);
    if (clash.rows.length) return { ok: false as const, reason: 'taken' as const };

    await client.query('update accounts set email = $2, email_verified_at = now() where id = $1', [row.account_id, row.old_email]);
    const cut = await client.query('update devices set account_id = null where account_id = $1 returning id', [row.account_id]);
    for (const table of ['resets', 'verifications', 'email_changes', 'email_undos']) {
      await client.query(`delete from ${table} where account_id = $1`, [row.account_id]);
    }
    return { ok: true as const, accountId: row.account_id, email: row.old_email, signedOut: cut.rows.length };
  });
  if (!done.ok) return done;

  await lockPassword(done.accountId);
  await requestReset(done.email, resetLink, await readerOf(done.accountId));
  return done;
}

export type AdminChange =
  | { ok: true; accountId: string; from: string; to: string; toldOld: boolean; verifySent: boolean }
  | { ok: false; reason: 'no_account' | 'bad_email' | 'same' | 'taken' };

/**
 * An admin moves an account to a new address: for somebody who has lost the
 * inbox they signed up with, or mistyped it, and so cannot use the link the
 * ordinary way sends.
 *
 * Nobody has proved the new inbox, so the new address starts unconfirmed and
 * gets the usual confirmation email. The old address, if it was confirmed,
 * gets the same notice and way back as any other move — an admin fooled by
 * somebody pretending to be the owner is exactly the case it is for. Links
 * already sent to the old address stop working, as they do after any move.
 * Devices stay signed in: the person asking for help is usually on one.
 */
export async function adminChangeEmail(
  rawCurrent: string,
  rawEmail: string,
  links: { verify: (token: string) => string; undo: (token: string) => string },
  origin: string,
): Promise<AdminChange> {
  await migrate();
  const current = normaliseEmail(rawCurrent);
  const email = normaliseEmail(rawEmail);
  if (!looksLikeEmail(email)) return { ok: false, reason: 'bad_email' };

  const done = await transaction(async (client) => {
    const account = (
      await client.query<{ id: string; email: string; verified: boolean }>(
        'select id, email, email_verified_at is not null as verified from accounts where lower(email) = $1 for update',
        [current],
      )
    ).rows[0];
    if (!account) return { ok: false as const, reason: 'no_account' as const };
    if (account.email === email) return { ok: false as const, reason: 'same' as const };
    const clash = await client.query('select 1 from accounts where email = $1 and id <> $2', [email, account.id]);
    if (clash.rows.length) return { ok: false as const, reason: 'taken' as const };

    await client.query('update accounts set email = $2, email_verified_at = null where id = $1', [account.id, email]);
    for (const table of ['resets', 'verifications', 'email_changes']) {
      await client.query(`delete from ${table} where account_id = $1`, [account.id]);
    }
    const undo = account.verified ? await leaveWayBack(client, account.id, account.email) : null;
    return { ok: true as const, accountId: account.id, from: account.email, undo };
  });
  if (!done.ok) return done;

  if (done.undo) await tellOldAddress(done.accountId, done.from, email, links.undo(done.undo), origin);
  const verifySent = await sendVerification(done.accountId, links.verify).then(
    () => canSendMail(),
    (error: unknown) => {
      console.warn('[squish] confirmation email after an admin change not sent:', error instanceof Error ? error.message : error);
      return false;
    },
  );
  return { ok: true, accountId: done.accountId, from: done.from, to: email, toldOld: Boolean(done.undo), verifySent };
}

export async function sweepEmailChanges(): Promise<void> {
  await migrate();
  await query('delete from email_changes where expires_at <= now()');
  await query('delete from email_undos where expires_at <= now()');
}
