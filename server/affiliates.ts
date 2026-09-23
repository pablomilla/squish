/**
 * Affiliates: people paid a share of what the subscribers they bring in pay.
 *
 * Built here rather than bought, because the usual affiliate services watch
 * card payments through Stripe, and Squish's subscriptions go through the App
 * Store and Google Play, which tell nobody where a customer came from. So the
 * link does the telling: squish.online/r/CODE sends somebody to the app with
 * the code, the app remembers it for 30 days, and the account made from it
 * records who sent it (accounts.referred_by). Commission is then worked out
 * from the payments ledger — see commissionIn in finance.ts — and payouts are
 * recorded here when they are made. Money moves by bank transfer, outside
 * Squish; this is the book it is kept in.
 *
 * The terms are stored per affiliate and default to the ones the costing was
 * done with: 30% of what reaches Industry Logic (after VAT and the store), for
 * a subscriber's first 12 months.
 */
import { randomBytes } from 'node:crypto';
import { migrate, query } from './db';
import { commissionIn } from './finance';

export interface Affiliate {
  id: string;
  name: string;
  code: string;
  email: string | null;
  rate: number;
  months: number;
  note: string | null;
  active: boolean;
  createdAt: string;
  clicks: number;
  signups: number;
  paying: number;
  /** When they last opened their partner page, if ever. */
  portalSeenAt: string | null;
  revenuePence: number;
  earnedPence: number;
  paidPence: number;
  owedPence: number;
}

export interface Payout {
  id: number;
  affiliateId: string;
  amountPence: number;
  note: string | null;
  paidAt: string;
  recordedBy: string | null;
}

/** Codes are compared as typed: case and stray spaces do not matter. */
export const tidyCode = (code: string): string => code.trim().toUpperCase();
const CODE = /^[A-Z0-9-]{3,24}$/;

export interface AffiliateInput {
  name: string;
  code: string;
  email: string | null;
  rate: number;
  months: number;
  note: string | null;
}

export function checkAffiliate(input: Record<string, unknown>): AffiliateInput | string {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const code = typeof input.code === 'string' ? tidyCode(input.code) : '';
  const email = typeof input.email === 'string' && input.email.trim() ? input.email.trim() : null;
  const rate = Number(input.rate);
  const months = Number(input.months);
  if (!name || name.length > 80) return 'A name, please — up to 80 characters.';
  if (!CODE.test(code)) return 'A code of 3 to 24 letters, numbers or dashes — it goes in their link.';
  if (email && (email.length > 200 || !email.includes('@'))) return "That email address doesn't look right.";
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) return 'Commission is a share between 0% and 100%.';
  if (!Number.isInteger(months) || months < 1 || months > 120) return 'Months has to be a whole number from 1 to 120.';
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : null;
  return { name, code, email, rate, months, note };
}

export async function createAffiliate(input: AffiliateInput): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  await migrate();
  const taken = await query('select 1 from affiliates where code = $1', [input.code]);
  if (taken.length) return { ok: false, message: `${input.code} is already somebody's code.` };
  const id = randomBytes(9).toString('base64url');
  await query('insert into affiliates (id, name, code, email, rate, months, note) values ($1, $2, $3, $4, $5, $6, $7)', [
    id,
    input.name,
    input.code,
    input.email,
    input.rate,
    input.months,
    input.note,
  ]);
  return { ok: true, id };
}

/**
 * Change an affiliate's details. The code cannot change: it is printed in
 * links already out in the world. Switching one off stops new sign-ups
 * counting for them; what they earned stays theirs.
 */
export async function updateAffiliate(
  id: string,
  changes: { name?: string; email?: string | null; rate?: number; months?: number; note?: string | null; active?: boolean },
): Promise<boolean> {
  await migrate();
  const rows = await query(
    `update affiliates set
       name = coalesce($2, name),
       email = case when $3::boolean then $4 else email end,
       rate = coalesce($5, rate),
       months = coalesce($6, months),
       note = case when $7::boolean then $8 else note end,
       active = coalesce($9, active)
     where id = $1 returning id`,
    [
      id,
      changes.name ?? null,
      'email' in changes,
      changes.email ?? null,
      changes.rate ?? null,
      changes.months ?? null,
      'note' in changes,
      changes.note ?? null,
      changes.active ?? null,
    ],
  );
  return rows.length > 0;
}

/** Every affiliate, or just the one asked for. */
export async function listAffiliates(onlyId?: string): Promise<Affiliate[]> {
  await migrate();
  const rows = await query<{
    id: string;
    name: string;
    code: string;
    email: string | null;
    rate: string;
    months: number;
    note: string | null;
    active: boolean;
    created_at: Date;
    clicks: number;
    signups: string;
    portal_seen: Date | null;
    paying: string;
    revenue: string;
    paid: string;
  }>(
    `select f.*,
       (select count(*) from accounts a where a.referred_by = f.id)::text as signups,
       (select count(distinct p.account_id) from payments p join accounts a on a.id = p.account_id
         where a.referred_by = f.id and p.kind <> 'refund'
           and p.occurred_at + (case when p.product = 'yearly' then interval '12 months' else interval '1 month' end) > now())::text as paying,
       (select coalesce(sum(p.net_pence), 0) from payments p join accounts a on a.id = p.account_id
         where a.referred_by = f.id)::text as revenue,
       (select coalesce(sum(amount_pence), 0) from affiliate_payouts o where o.affiliate_id = f.id)::text as paid,
       f.portal_seen_at as portal_seen
     from affiliates f
     where ($1::text is null or f.id = $1)
     order by f.active desc, f.created_at desc`,
    [onlyId ?? null],
  );
  return Promise.all(
    rows.map(async (row) => {
      const earned = await commissionIn('1970-01-01', '9999-12-31', row.id);
      const paid = Number(row.paid);
      return {
        id: row.id,
        name: row.name,
        code: row.code,
        email: row.email,
        rate: Number(row.rate),
        months: row.months,
        note: row.note,
        active: row.active,
        createdAt: row.created_at.toISOString(),
        clicks: row.clicks,
        signups: Number(row.signups),
        portalSeenAt: row.portal_seen?.toISOString() ?? null,
        paying: Number(row.paying),
        revenuePence: Number(row.revenue),
        earnedPence: earned,
        paidPence: paid,
        owedPence: earned - paid,
      };
    }),
  );
}

export async function recordPayout(
  affiliateId: string,
  amountPence: number,
  note: string | null,
  by: string,
): Promise<boolean> {
  await migrate();
  if (!Number.isInteger(amountPence) || amountPence <= 0) return false;
  const found = await query('select 1 from affiliates where id = $1', [affiliateId]);
  if (!found.length) return false;
  await query('insert into affiliate_payouts (affiliate_id, amount_pence, note, recorded_by) values ($1, $2, $3, $4)', [
    affiliateId,
    amountPence,
    note,
    by,
  ]);
  return true;
}

export async function payouts(affiliateId?: string, limit = 50): Promise<Payout[]> {
  await migrate();
  const rows = await query<{ id: number; affiliate_id: string; amount_pence: number; note: string | null; paid_at: Date; recorded_by: string | null }>(
    `select * from affiliate_payouts where ($1::text is null or affiliate_id = $1) order by paid_at desc limit $2`,
    [affiliateId ?? null, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    affiliateId: row.affiliate_id,
    amountPence: row.amount_pence,
    note: row.note,
    paidAt: row.paid_at.toISOString(),
    recordedBy: row.recorded_by,
  }));
}

/**
 * Credit a new account to whoever's code it arrived with. Quietly does nothing
 * for a code that does not exist or has been switched off — a stale link must
 * never stop somebody signing up.
 */
export async function attribute(accountId: string, code: unknown): Promise<string | null> {
  if (typeof code !== 'string' || !code.trim()) return null;
  const tidy = tidyCode(code);
  if (!CODE.test(tidy)) return null;
  const rows = await query<{ id: string }>('select id from affiliates where code = $1 and active', [tidy]);
  const id = rows[0]?.id;
  if (!id) return null;
  await query('update accounts set referred_by = $2, referred_at = now() where id = $1 and referred_by is null', [accountId, id]);
  return id;
}

/**
 * Count a visit to somebody's link. Only a number goes up: nothing about the
 * visitor is kept, and a code that is not live counts for nothing.
 */
export async function noteClick(code: string): Promise<boolean> {
  const tidy = tidyCode(code);
  if (!CODE.test(tidy)) return false;
  await migrate();
  const rows = await query<{ id: string }>('update affiliates set clicks = clicks + 1 where code = $1 and active returning id', [tidy]);
  const id = rows[0]?.id;
  if (!id) return false;
  await query(
    `insert into affiliate_clicks (affiliate_id, day, clicks) values ($1, current_date, 1)
     on conflict (affiliate_id, day) do update set clicks = affiliate_clicks.clicks + 1`,
    [id],
  );
  return true;
}
