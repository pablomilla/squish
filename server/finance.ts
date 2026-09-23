/**
 * The dashboard's money and trends: what came in, what went out, and how the
 * people using Squish are moving.
 *
 * Every figure here is either measured or labelled as not being. Costs are
 * measured: each AI call's price is recorded as it happens (usage.cost_usd),
 * and fixed costs are the list somebody keeps in the dashboard. Revenue is
 * measured too, from `payments` — the ledger the App Store and Google Play
 * integration writes to — which is empty until Plus goes on sale. Until then
 * the P&L says so, and the only revenue figure is a projection, called one.
 *
 * Money is in pence throughout, and turned into pounds only for display.
 * Dollars (AI, hosting) become pounds at the exchange rate in the settings.
 *
 * Nothing here reads a diary. Counts, totals and money only.
 */
import { migrate, query } from './db';
import { ALLOWANCE } from './plan';

/* ---------------- Settings ---------------- */

export interface FinanceSettings {
  /** Pounds per dollar. */
  usdToGbp: number;
  priceMonthly: number;
  priceYearly: number;
  /** The store's share of the price after VAT: 0.15 on the small-business programmes, 0.3 otherwise. */
  storeCut: number;
  vat: number;
}

export const DEFAULT_SETTINGS: FinanceSettings = {
  usdToGbp: 0.78,
  priceMonthly: 6.99,
  priceYearly: 49.99,
  storeCut: 0.15,
  vat: 0.2,
};

const SETTING_RULES: Record<keyof FinanceSettings, [number, number]> = {
  usdToGbp: [0.3, 2],
  priceMonthly: [0, 100],
  priceYearly: [0, 1000],
  storeCut: [0, 0.5],
  vat: [0, 0.5],
};

export async function readSettings(): Promise<FinanceSettings> {
  await migrate();
  const rows = await query<{ key: string; value: string }>('select key, value from admin_settings');
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in settings) {
      const value = Number(row.value);
      if (Number.isFinite(value)) settings[row.key as keyof FinanceSettings] = value;
    }
  }
  return settings;
}

/** Save whichever settings are given and valid; returns what is now in force, or the first problem. */
export async function saveSettings(
  changes: Partial<Record<keyof FinanceSettings, unknown>>,
): Promise<{ ok: true; settings: FinanceSettings } | { ok: false; message: string }> {
  await migrate();
  const valid: [string, number][] = [];
  for (const [key, raw] of Object.entries(changes)) {
    if (!(key in SETTING_RULES)) continue;
    const value = Number(raw);
    const [lo, hi] = SETTING_RULES[key as keyof FinanceSettings];
    if (!Number.isFinite(value) || value < lo || value > hi) {
      return { ok: false, message: `${key} has to be between ${lo} and ${hi}.` };
    }
    valid.push([key, value]);
  }
  for (const [key, value] of valid) {
    await query(
      `insert into admin_settings (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, String(value)],
    );
  }
  return { ok: true, settings: await readSettings() };
}

/** What one subscriber-month on each plan leaves after VAT and the store, in pence. */
export function netPerMonth(settings: FinanceSettings): { monthly: number; yearly: number } {
  const net = (gross: number) => (gross / (1 + settings.vat)) * (1 - settings.storeCut) * 100;
  return { monthly: net(settings.priceMonthly), yearly: net(settings.priceYearly) / 12 };
}

/* ---------------- Fixed costs ---------------- */

export interface FixedCost {
  id: number;
  label: string;
  amount: number;
  currency: 'GBP' | 'USD';
  period: 'month' | 'year';
  active: boolean;
  /** What it comes to in a month, in pence, at the settings' exchange rate. */
  monthlyPence: number;
}

export async function fixedCosts(settings?: FinanceSettings): Promise<FixedCost[]> {
  await migrate();
  const rate = (settings ?? (await readSettings())).usdToGbp;
  const rows = await query<{ id: number; label: string; amount: string; currency: 'GBP' | 'USD'; period: 'month' | 'year'; active: boolean }>(
    'select id, label, amount, currency, period, active from fixed_costs order by id',
  );
  return rows.map((row) => {
    const amount = Number(row.amount);
    const pounds = row.currency === 'USD' ? amount * rate : amount;
    return { ...row, amount, monthlyPence: Math.round(((row.period === 'year' ? pounds / 12 : pounds) * 100)) };
  });
}

export type CostInput = { label: string; amount: number; currency: 'GBP' | 'USD'; period: 'month' | 'year'; active?: boolean };

export function checkCost(input: Record<string, unknown>): CostInput | string {
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const amount = Number(input.amount);
  if (!label || label.length > 80) return 'Give it a name, up to 80 characters.';
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) return 'The amount has to be a number of pounds or dollars.';
  if (input.currency !== 'GBP' && input.currency !== 'USD') return 'Pounds or dollars.';
  if (input.period !== 'month' && input.period !== 'year') return 'A month or a year.';
  return { label, amount, currency: input.currency, period: input.period, active: input.active !== false };
}

export async function addCost(cost: CostInput): Promise<void> {
  await migrate();
  await query('insert into fixed_costs (label, amount, currency, period, active) values ($1, $2, $3, $4, $5)', [
    cost.label,
    cost.amount,
    cost.currency,
    cost.period,
    cost.active !== false,
  ]);
}

export async function updateCost(id: number, cost: CostInput): Promise<boolean> {
  await migrate();
  const rows = await query(
    'update fixed_costs set label = $2, amount = $3, currency = $4, period = $5, active = $6 where id = $1 returning id',
    [id, cost.label, cost.amount, cost.currency, cost.period, cost.active !== false],
  );
  return rows.length > 0;
}

export async function removeCost(id: number): Promise<void> {
  await migrate();
  await query('delete from fixed_costs where id = $1', [id]);
}

/* ---------------- The monthly P&L ---------------- */

export interface MonthPnl {
  /** yyyy-mm */
  month: string;
  /** Whether this month is still going. */
  current: boolean;
  payments: number;
  grossPence: number;
  vatPence: number;
  storeFeePence: number;
  refundsPence: number;
  netPence: number;
  commissionPence: number;
  aiPence: number;
  aiByKind: { kind: string; calls: number; pence: number }[];
  fixedPence: number;
  profitPence: number;
}

const monthStart = (month: string) => `${month}-01`;

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export const thisMonth = (): string => new Date().toISOString().slice(0, 7);

export const isMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/**
 * One month's profit and loss.
 *
 * Fixed costs are today's list applied to every month — the dashboard keeps no
 * history of what hosting cost last spring — which is right for the recent
 * months it shows and would want revisiting if it ever showed years.
 */
export async function monthPnl(month: string, settings?: FinanceSettings, fixed?: FixedCost[]): Promise<MonthPnl> {
  await migrate();
  const s = settings ?? (await readSettings());
  const costs = fixed ?? (await fixedCosts(s));
  const from = monthStart(month);
  const to = monthStart(shiftMonth(month, 1));

  const [money, ai, commission] = await Promise.all([
    query<{ payments: string; gross: string; vat: string; fee: string; refunds: string; net: string }>(
      `select count(*)::text as payments,
              coalesce(sum(gross_pence), 0)::text as gross,
              coalesce(sum(vat_pence), 0)::text as vat,
              coalesce(sum(store_fee_pence), 0)::text as fee,
              coalesce(-sum(net_pence) filter (where kind = 'refund'), 0)::text as refunds,
              coalesce(sum(net_pence), 0)::text as net
         from payments where occurred_at >= $1 and occurred_at < $2`,
      [from, to],
    ),
    query<{ kind: string; calls: string; usd: string }>(
      `select kind, sum(count)::text as calls, coalesce(sum(cost_usd), 0)::text as usd
         from usage where day >= $1 and day < $2 and kind in ('photo', 'chat', 'recipe')
        group by kind order by kind`,
      [from, to],
    ),
    commissionIn(from, to),
  ]);

  const m = money[0];
  const aiByKind = ai.map((row) => ({ kind: row.kind, calls: Number(row.calls), pence: Math.round(Number(row.usd) * s.usdToGbp * 100) }));
  const aiPence = aiByKind.reduce((sum, row) => sum + row.pence, 0);
  const fixedPence = costs.filter((c) => c.active).reduce((sum, c) => sum + c.monthlyPence, 0);
  const netPence = Number(m.net);

  return {
    month,
    current: month === thisMonth(),
    payments: Number(m.payments),
    grossPence: Number(m.gross),
    vatPence: Number(m.vat),
    storeFeePence: Number(m.fee),
    refundsPence: Number(m.refunds),
    netPence,
    commissionPence: commission,
    aiPence,
    aiByKind,
    fixedPence,
    profitPence: netPence - commission - aiPence - fixedPence,
  };
}

/**
 * Affiliate commission earned on payments in a window: each referred account's
 * payments within the affiliate's months of the referral, at their rate, on
 * what reached Industry Logic. A refund inside the window takes its share back.
 */
export async function commissionIn(from: string, to: string, affiliateId?: string): Promise<number> {
  const rows = await query<{ pence: string }>(
    `select coalesce(round(sum(p.net_pence * f.rate)), 0)::text as pence
       from payments p
       join accounts a on a.id = p.account_id
       join affiliates f on f.id = a.referred_by
      where p.occurred_at >= $1 and p.occurred_at < $2
        and p.occurred_at >= a.referred_at
        and p.occurred_at < a.referred_at + make_interval(months => f.months)
        and ($3::text is null or f.id = $3)`,
    [from, to, affiliateId ?? null],
  );
  return Number(rows[0]?.pence ?? 0);
}

/** Subscribers paying right now: a purchase or renewal whose period has not run out, not refunded. */
async function payingNow(): Promise<{ accounts: number; monthly: number; yearly: number; mrrPence: number }> {
  const rows = await query<{ product: string; subs: string; mrr: string }>(
    `with latest as (
       select distinct on (account_id) account_id, product, kind, net_pence, occurred_at
         from payments where account_id is not null
        order by account_id, occurred_at desc
     )
     select product, count(*)::text as subs,
            coalesce(sum(case when product = 'yearly' then net_pence / 12.0 else net_pence end), 0)::text as mrr
       from latest
      where kind <> 'refund'
        and occurred_at + (case when product = 'yearly' then interval '12 months' else interval '1 month' end) > now()
      group by product`,
  );
  const by = Object.fromEntries(rows.map((r) => [r.product, r]));
  const monthly = Number(by.monthly?.subs ?? 0);
  const yearly = Number(by.yearly?.subs ?? 0);
  return { accounts: monthly + yearly, monthly, yearly, mrrPence: Math.round(rows.reduce((s, r) => s + Number(r.mrr), 0)) };
}

export interface Finance {
  month: MonthPnl;
  /** The six months up to and including the one asked for, oldest first. */
  history: MonthPnl[];
  settings: FinanceSettings;
  fixed: FixedCost[];
  paying: { accounts: number; monthly: number; yearly: number; mrrPence: number };
  /** Plus accounts nobody is paying for: testers, invite codes, grants. */
  compedPlus: number;
  /** What the Plus accounts there are now would bring in at list price — a projection, not revenue. */
  projection: { plusAccounts: number; perMonthPence: number };
  /** False until the first payment arrives, so the screen can say why revenue is nought. */
  onSale: boolean;
}

export async function finance(month: string): Promise<Finance> {
  const settings = await readSettings();
  const fixed = await fixedCosts(settings);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const history = await Promise.all(months.map((m) => monthPnl(m, settings, fixed)));
  const paying = await payingNow();
  const plus = await query<{ n: string }>('select count(*)::text as n from accounts where plus_until > now()');
  const anyPayment = await query('select 1 from payments limit 1');
  const plusAccounts = Number(plus[0].n);
  const net = netPerMonth(settings);

  return {
    month: history[history.length - 1],
    history,
    settings,
    fixed,
    paying,
    compedPlus: Math.max(0, plusAccounts - paying.accounts),
    // Weighted as the costing assumes: 60% on the yearly plan.
    projection: { plusAccounts, perMonthPence: Math.round(plusAccounts * (0.4 * net.monthly + 0.6 * net.yearly)) },
    onSale: anyPayment.length > 0,
  };
}

/* ---------------- Trends ---------------- */

export interface DayPoint {
  day: string;
  active: number;
  signups: number;
  analyses: number;
  aiPence: { photo: number; chat: number; recipe: number };
}

export interface Metrics {
  days: number;
  series: DayPoint[];
  totals: { active: number; signups: number; aiPence: number; analyses: number };
  previous: { active: number; signups: number; aiPence: number; analyses: number };
  plans: { accounts: number; free: number; compedPlus: number; payingPlus: number; signedOutActive: number };
  funnel: { accounts: number; triedAi: number; usedTaste: number; plus: number; paying: number };
  /** The first day activity was recorded, so a short history is explained rather than mistaken for a quiet month. */
  recordedSince: string | null;
}

async function periodTotals(from: string, to: string, usdToGbp: number) {
  const rows = await query<{ active: string; signups: string; usd: string; analyses: string }>(
    `select
       (select count(distinct coalesce(d.account_id, d.id)) from device_days dd join devices d on d.id = dd.device_id
         where dd.day >= $1 and dd.day < $2)::text as active,
       (select count(*) from accounts where created_at >= $1 and created_at < $2)::text as signups,
       (select coalesce(sum(cost_usd), 0) from usage where day >= $1 and day < $2 and kind in ('photo', 'chat', 'recipe'))::text as usd,
       (select coalesce(sum(count), 0) from usage where day >= $1 and day < $2 and kind = 'photo')::text as analyses`,
    [from, to],
  );
  const r = rows[0];
  return {
    active: Number(r.active),
    signups: Number(r.signups),
    aiPence: Math.round(Number(r.usd) * usdToGbp * 100),
    analyses: Number(r.analyses),
  };
}

export async function metrics(days: number): Promise<Metrics> {
  await migrate();
  const settings = await readSettings();
  const span = Math.min(365, Math.max(7, Math.round(days)));

  const series = await query<{ day: string; active: string; signups: string; analyses: string; photo: string; chat: string; recipe: string }>(
    `with days as (
       select generate_series(current_date - ($1::int - 1), current_date, interval '1 day')::date as day
     )
     select to_char(days.day, 'YYYY-MM-DD') as day,
       (select count(distinct coalesce(d.account_id, d.id)) from device_days dd join devices d on d.id = dd.device_id
         where dd.day = days.day)::text as active,
       (select count(*) from accounts where created_at::date = days.day)::text as signups,
       (select coalesce(sum(count), 0) from usage where day = days.day and kind = 'photo')::text as analyses,
       (select coalesce(sum(cost_usd), 0) from usage where day = days.day and kind = 'photo')::text as photo,
       (select coalesce(sum(cost_usd), 0) from usage where day = days.day and kind = 'chat')::text as chat,
       (select coalesce(sum(cost_usd), 0) from usage where day = days.day and kind = 'recipe')::text as recipe
     from days order by days.day`,
    [span],
  );

  const pence = (usd: string) => Math.round(Number(usd) * settings.usdToGbp * 100);
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (span - 1)));
  const tomorrow = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  const before = new Date(start.getTime() - span * 86_400_000);

  const [totals, previous, plans, funnel, since, paying] = await Promise.all([
    periodTotals(iso(start), iso(tomorrow), settings.usdToGbp),
    periodTotals(iso(before), iso(start), settings.usdToGbp),
    query<{ accounts: string; plus: string; signed_out: string }>(
      `select
         (select count(*) from accounts)::text as accounts,
         (select count(*) from accounts where plus_until > now())::text as plus,
         (select count(distinct dd.device_id) from device_days dd join devices d on d.id = dd.device_id
           where d.account_id is null and dd.day >= $1)::text as signed_out`,
      [iso(start)],
    ),
    query<{ accounts: string; tried: string; used: string; plus: string; paying: string }>(
      `with spent as (
         select d.account_id, sum(u.count) as n
           from usage u join devices d on d.id = u.device_id
          where d.account_id is not null and u.kind = 'photo'
          group by d.account_id
       )
       select
         (select count(*) from accounts)::text as accounts,
         (select count(*) from spent where n > 0)::text as tried,
         (select count(*) from spent where n >= $1)::text as used,
         (select count(*) from accounts where plus_until > now())::text as plus,
         (select count(distinct account_id) from payments where account_id is not null and kind <> 'refund')::text as paying`,
      [ALLOWANCE.free.photo],
    ),
    query<{ first: string | null }>(`select to_char(min(day), 'YYYY-MM-DD') as first from device_days`),
    payingNow(),
  ]);

  const p = plans[0];
  const plus = Number(p.plus);
  const payingPlus = Math.min(plus, paying.accounts);
  const f = funnel[0];

  return {
    days: span,
    series: series.map((row) => ({
      day: row.day,
      active: Number(row.active),
      signups: Number(row.signups),
      analyses: Number(row.analyses),
      aiPence: { photo: pence(row.photo), chat: pence(row.chat), recipe: pence(row.recipe) },
    })),
    totals,
    previous,
    plans: {
      accounts: Number(p.accounts),
      free: Number(p.accounts) - plus,
      compedPlus: plus - payingPlus,
      payingPlus,
      signedOutActive: Number(p.signed_out),
    },
    funnel: {
      accounts: Number(f.accounts),
      triedAi: Number(f.tried),
      usedTaste: Number(f.used),
      plus: Number(f.plus),
      paying: Number(f.paying),
    },
    recordedSince: since[0]?.first ?? null,
  };
}
