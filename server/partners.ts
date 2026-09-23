/**
 * The partner page: where an affiliate signs in and sees how their link is
 * doing — visits, sign-ups, subscribers, what they have earned and been paid.
 *
 * Partners are not app accounts. They sign in with their email address and a
 * link sent to it, because a password is one more thing for somebody who
 * visits once a month to forget, and one more thing for us to keep. A link is
 * spent once and dies in half an hour; the session it starts lasts 30 days in
 * that browser. Everything is stored hashed, as reset links are.
 *
 * What a partner sees is counts and money. Never who signed up, never an
 * email address, never anything from a diary — the same line the dashboard
 * holds, drawn tighter.
 */
import { createHash, randomBytes } from 'node:crypto';
import { migrate, query } from './db';
import { commissionIn } from './finance';
import { listAffiliates, type Affiliate } from './affiliates';
import { compose, originOf } from './emails';
import { canSendMail, sendMail } from './mail';

export const LINK_MINUTES = 30;
/** Links made in the dashboard to paste into a message last longer: nobody reads a DM in half an hour. */
export const HANDED_LINK_DAYS = 3;
export const SESSION_DAYS = 30;
const LINKS_PER_HOUR = 3;

const hash = (token: string): string => createHash('sha256').update(token).digest('base64');
const mint = (): string => randomBytes(32).toString('base64url');

/** The partner whose address this is: the live one where there are two. */
async function partnerByEmail(email: string): Promise<{ id: string; name: string; email: string } | null> {
  const address = email.trim().toLowerCase();
  if (!address || address.length > 200) return null;
  const rows = await query<{ id: string; name: string; email: string }>(
    `select id, name, email from affiliates where lower(email) = $1 order by active desc, created_at desc limit 1`,
    [address],
  );
  return rows[0] ?? null;
}

/** Whether another partner already has this address — each address signs in to one page. */
export async function emailTaken(email: string | null, exceptId?: string): Promise<boolean> {
  if (!email) return false;
  await migrate();
  const rows = await query('select 1 from affiliates where lower(email) = $1 and ($2::text is null or id <> $2)', [
    email.trim().toLowerCase(),
    exceptId ?? null,
  ]);
  return rows.length > 0;
}

async function newLink(affiliateId: string, minutes: number): Promise<string> {
  const token = mint();
  await query(
    `insert into affiliate_links (token_hash, affiliate_id, expires_at) values ($1, $2, now() + make_interval(mins => $3))`,
    [hash(token), affiliateId, minutes],
  );
  return token;
}

const expiryWords = (minutes: number): string =>
  minutes % 1440 === 0 ? `${minutes / 1440} days` : minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} minutes`;

/**
 * Email a sign-in link, and say nothing about whether the address is a
 * partner's: the answer is the same either way, so the form cannot be used to
 * find out who is one. A few an hour per partner, so it cannot be used to
 * fill somebody's inbox either.
 */
export async function requestPartnerLink(email: string, url: (token: string) => string): Promise<void> {
  await migrate();
  const partner = await partnerByEmail(email);
  if (!partner || !canSendMail()) return;
  const recent = await query<{ n: string }>(
    `select count(*)::text as n from affiliate_links where affiliate_id = $1 and created_at > now() - interval '1 hour'`,
    [partner.id],
  );
  if (Number(recent[0].n) >= LINKS_PER_HOUR) return;
  const link = url(await newLink(partner.id, LINK_MINUTES));
  await sendMail(
    await compose('partner-signin', partner.email, { name: partner.name, link, expiry: expiryWords(LINK_MINUTES) }, originOf(link)),
  );
}

/**
 * A link made from the dashboard: emailed to the partner, or handed back for
 * the admin to send however they talk to them.
 */
export async function handPartnerLink(
  affiliateId: string,
  url: (token: string) => string,
  send: boolean,
): Promise<{ ok: true; url: string; sent: boolean } | { ok: false; reason: 'not_found' | 'no_email' | 'no_mail' }> {
  await migrate();
  const rows = await query<{ name: string; email: string | null }>('select name, email from affiliates where id = $1', [affiliateId]);
  const partner = rows[0];
  if (!partner) return { ok: false, reason: 'not_found' };
  if (send && !partner.email) return { ok: false, reason: 'no_email' };
  if (send && !canSendMail()) return { ok: false, reason: 'no_mail' };
  const minutes = HANDED_LINK_DAYS * 1440;
  const link = url(await newLink(affiliateId, minutes));
  if (send && partner.email) {
    await sendMail(await compose('partner-signin', partner.email, { name: partner.name, link, expiry: expiryWords(minutes) }, originOf(link)));
  }
  return { ok: true, url: link, sent: send };
}

/** Spend a link and start a session. Null for a link that is unknown, used or out of date — all the same to whoever asks. */
export async function claimPartnerLink(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  await migrate();
  const rows = await query<{ affiliate_id: string }>(
    `update affiliate_links set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning affiliate_id`,
    [hash(token)],
  );
  const affiliateId = rows[0]?.affiliate_id;
  if (!affiliateId) return null;
  const session = mint();
  await query(
    `insert into affiliate_sessions (token_hash, affiliate_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`,
    [hash(session), affiliateId, SESSION_DAYS],
  );
  return session;
}

/** Whose session this is, if it is one. */
export async function partnerFor(session: string | undefined): Promise<string | null> {
  if (!session || session.length > 100) return null;
  await migrate();
  const rows = await query<{ affiliate_id: string }>(
    `update affiliate_sessions set last_seen_at = now()
      where token_hash = $1 and expires_at > now()
      returning affiliate_id`,
    [hash(session)],
  );
  const id = rows[0]?.affiliate_id ?? null;
  if (id) await query('update affiliates set portal_seen_at = now() where id = $1', [id]);
  return id;
}

export async function endPartnerSession(session: string | undefined): Promise<void> {
  if (!session) return;
  await query('delete from affiliate_sessions where token_hash = $1', [hash(session)]);
}

/** Sign a partner out everywhere: when they are switched off, or asked. */
export async function endPartnerSessions(affiliateId: string): Promise<void> {
  await query('delete from affiliate_sessions where affiliate_id = $1', [affiliateId]);
}

/* ---------------- What they see ---------------- */

export interface PartnerView {
  name: string;
  code: string;
  rate: number;
  months: number;
  active: boolean;
  since: string;
  totals: Pick<Affiliate, 'clicks' | 'signups' | 'paying' | 'revenuePence' | 'earnedPence' | 'paidPence' | 'owedPence'>;
  /** The last 30 days, oldest first. */
  days: { day: string; clicks: number; signups: number }[];
  /** The last 12 months, oldest first. */
  byMonth: { month: string; signups: number; earnedPence: number }[];
  payouts: { amountPence: number; paidAt: string; note: string | null }[];
}

function monthsBack(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1)).toISOString().slice(0, 7),
  );
}

const nextMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

export async function partnerView(affiliateId: string): Promise<PartnerView | null> {
  await migrate();
  const found = (await listAffiliates(affiliateId))[0];
  if (!found) return null;

  const [days, signupMonths, paid] = await Promise.all([
    query<{ day: string; clicks: string; signups: string }>(
      `with days as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day)
       select to_char(days.day, 'YYYY-MM-DD') as day,
         coalesce((select clicks from affiliate_clicks c where c.affiliate_id = $1 and c.day = days.day), 0)::text as clicks,
         (select count(*) from accounts a where a.referred_by = $1 and a.referred_at::date = days.day)::text as signups
       from days order by days.day`,
      [affiliateId],
    ),
    query<{ month: string; signups: string }>(
      `select to_char(referred_at, 'YYYY-MM') as month, count(*)::text as signups
         from accounts where referred_by = $1 and referred_at > now() - interval '13 months'
        group by 1`,
      [affiliateId],
    ),
    query<{ amount_pence: number; paid_at: Date; note: string | null }>(
      'select amount_pence, paid_at, note from affiliate_payouts where affiliate_id = $1 order by paid_at desc limit 50',
      [affiliateId],
    ),
  ]);

  const signupsBy = Object.fromEntries(signupMonths.map((r) => [r.month, Number(r.signups)]));
  const byMonth = await Promise.all(
    monthsBack(12).map(async (month) => ({
      month,
      signups: signupsBy[month] ?? 0,
      earnedPence: await commissionIn(`${month}-01`, `${nextMonth(month)}-01`, affiliateId),
    })),
  );

  return {
    name: found.name,
    code: found.code,
    rate: found.rate,
    months: found.months,
    active: found.active,
    since: found.createdAt,
    totals: {
      clicks: found.clicks,
      signups: found.signups,
      paying: found.paying,
      revenuePence: found.revenuePence,
      earnedPence: found.earnedPence,
      paidPence: found.paidPence,
      owedPence: found.owedPence,
    },
    days: days.map((d) => ({ day: d.day, clicks: Number(d.clicks), signups: Number(d.signups) })),
    byMonth,
    payouts: paid.map((p) => ({ amountPence: p.amount_pence, paidAt: p.paid_at.toISOString(), note: p.note })),
  };
}
