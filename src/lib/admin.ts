/**
 * The dashboard's side of the wire.
 *
 * Nothing here decides anything — whether somebody is an admin is answered by
 * the server on every request, and these routes simply return 404 to anybody
 * who is not. Hiding the link in the app is a convenience, never the lock.
 */
import { apiUrl } from './origin';
import { deviceToken } from './identity';

export interface Overview {
  accounts: number;
  plus: number;
  devices: number;
  activeThisMonth: number;
  spend: { kind: string; calls: number; usd: number }[];
  totalUsd: number;
  month: string;
  allowances: Record<'free' | 'plus', Record<string, number>>;
  invites: Invite[];
  suggestion: string;
  mailReady: boolean;
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

export interface Redemption {
  code: string;
  email: string;
  days: number;
  usedAt: string;
}

export interface Person {
  id: string;
  email: string;
  verified: boolean;
  plan: 'free' | 'plus';
  plusUntil: string | null;
  joined: string;
  used: Record<string, number>;
  usd: number;
}

export interface AdminAction {
  admin: string;
  action: string;
  subject: string | null;
  detail: string | null;
  at: string;
}

async function ask<T>(path: string, method = 'GET', body?: unknown): Promise<T | null> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export const fetchOverview = (): Promise<Overview | null> => ask<Overview>('/api/admin/overview');

export const fetchPeople = (search: string): Promise<{ people: Person[]; actions: AdminAction[] } | null> =>
  ask(`/api/admin/people?q=${encodeURIComponent(search)}`);

export type PlanChange = { ok: true; until: string | null } | { ok: false; message: string };

export async function setPlan(email: string, days: number): Promise<PlanChange> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl('/api/admin/plan'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ email, days }),
    });
    const payload = (await response.json().catch(() => ({}))) as { until?: string; message?: string };
    if (!response.ok) return { ok: false, message: payload.message ?? 'That did not work.' };
    return { ok: true, until: payload.until ?? null };
  } catch {
    return { ok: false, message: 'Could not reach Squish just now.' };
  }
}

export const fetchInvites = (): Promise<{ invites: Invite[]; redemptions: Redemption[]; suggestion: string } | null> =>
  ask('/api/admin/invites');

export type MadeInvite = { ok: true; invite: Invite } | { ok: false; message: string };

export async function createInvite(input: {
  code: string;
  days: number;
  uses: number | null;
  note: string | null;
}): Promise<MadeInvite> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl('/api/admin/invites'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(input),
    });
    const payload = (await response.json().catch(() => ({}))) as Invite & { message?: string };
    if (!response.ok) return { ok: false, message: payload.message ?? 'That did not work.' };
    return { ok: true, invite: payload };
  } catch {
    return { ok: false, message: 'Could not reach Squish just now.' };
  }
}

export const setInviteDisabled = (code: string, disabled: boolean): Promise<unknown> =>
  ask(`/api/admin/invites/${encodeURIComponent(code)}`, 'PATCH', { disabled });

export const deleteInvite = (code: string): Promise<unknown> =>
  ask(`/api/admin/invites/${encodeURIComponent(code)}`, 'DELETE');

export type TestMail = { ok: true; to: string } | { ok: false; message: string };

/** Send the admin one email, to prove the setup works end to end. */
export async function sendTestMail(): Promise<TestMail> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl('/api/admin/test-mail'), {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const payload = (await response.json().catch(() => ({}))) as { to?: string; message?: string };
    if (!response.ok) return { ok: false, message: payload.message ?? 'It did not send.' };
    return { ok: true, to: payload.to ?? '' };
  } catch {
    return { ok: false, message: 'Could not reach Squish just now.' };
  }
}

export interface EmailWording {
  subject: string;
  body: string;
  buttonLabel: string | null;
}

export interface EmailTemplate {
  key: string;
  label: string;
  when: string;
  button: { placeholder: string; label: string; fallback: boolean } | null;
  placeholders: { name: string; about: string; sample: string; url?: boolean }[];
  required: string[];
  original: EmailWording;
  current: EmailWording;
  customised: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface EmailPreview {
  problems: string[];
  subject: string;
  text: string;
  html: string;
}

export type EmailDone = { ok: true; to?: string } | { ok: false; message: string; problems?: string[] };

async function send(path: string, method: string, body?: unknown): Promise<EmailDone> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json().catch(() => ({}))) as { to?: string; message?: string; problems?: string[] };
    if (!response.ok) return { ok: false, message: payload.message ?? 'That did not work.', problems: payload.problems };
    return { ok: true, to: payload.to };
  } catch {
    return { ok: false, message: 'Could not reach Squish just now.' };
  }
}

const emailPath = (key: string) => `/api/admin/emails/${encodeURIComponent(key)}`;

export const fetchEmails = (): Promise<{ emails: EmailTemplate[] } | null> => ask('/api/admin/emails');

/** The wording filled in with sample values, as it would arrive. Saves nothing. */
export const previewEmail = (key: string, wording: EmailWording): Promise<EmailPreview | null> =>
  ask(`${emailPath(key)}/preview`, 'POST', wording);

export const saveEmail = (key: string, wording: EmailWording): Promise<EmailDone> => send(emailPath(key), 'PUT', wording);

export const resetEmail = (key: string): Promise<EmailDone> => send(emailPath(key), 'DELETE');

/** Send the admin this wording — unsaved, if that is what is in the editor. */
export const testEmail = (key: string, wording: EmailWording): Promise<EmailDone> =>
  send(`${emailPath(key)}/test`, 'POST', wording);

/* ---------------- The second step ---------------- */

export interface TwoFactorState {
  enrolled: boolean;
  passed: boolean;
  until: string | null;
  recoveryLeft: number;
}

export interface TwoFactorSetup {
  secret: string;
  uri: string;
  qr: string;
}

export type Answer<T> = ({ ok: true } & T) | { ok: false; message: string };

async function call<T>(path: string, body: unknown = {}): Promise<Answer<T>> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) return { ok: false, message: payload.message ?? 'That did not work.' };
    return { ok: true, ...payload };
  } catch {
    return { ok: false, message: 'Could not reach Squish just now.' };
  }
}

export const fetchTwoFactor = (): Promise<TwoFactorState | null> => ask('/api/admin/2fa');

export const startTwoFactor = (): Promise<Answer<TwoFactorSetup>> => call('/api/admin/2fa/setup');

export const enableTwoFactor = (password: string, code: string): Promise<Answer<{ recoveryCodes: string[] }>> =>
  call('/api/admin/2fa/enable', { password, code });

export const verifyTwoFactor = (code: string): Promise<Answer<{ usedRecovery: boolean; recoveryLeft: number }>> =>
  call('/api/admin/2fa/verify', { code });

export const newRecoveryCodes = (password: string): Promise<Answer<{ recoveryCodes: string[] }>> =>
  call('/api/admin/2fa/recovery', { password });

export const lockDashboard = (): Promise<Answer<object>> => call('/api/admin/2fa/lock');

/* ---------------- Trends, money and affiliates ---------------- */

export interface DayPoint {
  day: string;
  active: number;
  signups: number;
  analyses: number;
  aiPence: { photo: number; chat: number; recipe: number };
}

export interface PeriodTotals {
  active: number;
  signups: number;
  aiPence: number;
  analyses: number;
}

export interface Metrics {
  days: number;
  series: DayPoint[];
  totals: PeriodTotals;
  previous: PeriodTotals;
  plans: { accounts: number; free: number; compedPlus: number; payingPlus: number; signedOutActive: number };
  funnel: { accounts: number; triedAi: number; usedTaste: number; plus: number; paying: number };
  recordedSince: string | null;
}

export interface MonthPnl {
  month: string;
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

export interface FinanceSettings {
  usdToGbp: number;
  priceMonthly: number;
  priceYearly: number;
  storeCut: number;
  vat: number;
}

export interface FixedCost {
  id: number;
  label: string;
  amount: number;
  currency: 'GBP' | 'USD';
  period: 'month' | 'year';
  active: boolean;
  monthlyPence: number;
}

export interface Finance {
  month: MonthPnl;
  history: MonthPnl[];
  settings: FinanceSettings;
  fixed: FixedCost[];
  paying: { accounts: number; monthly: number; yearly: number; mrrPence: number };
  compedPlus: number;
  projection: { plusAccounts: number; perMonthPence: number };
  onSale: boolean;
}

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

/** Any change, answered with the server's own explanation when it says no. */
async function change<T = object>(path: string, method: string, body?: unknown): Promise<Answer<T>> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) return { ok: false, message: payload.message ?? 'That did not work.' };
    return { ok: true, ...payload };
  } catch {
    return { ok: false, message: 'Could not reach Squish just now.' };
  }
}

export const fetchMetrics = (days: number): Promise<Metrics | null> => ask(`/api/admin/metrics?days=${days}`);

export const fetchFinance = (month?: string): Promise<Finance | null> =>
  ask(`/api/admin/finance${month ? `?month=${encodeURIComponent(month)}` : ''}`);

export const saveSettings = (settings: Partial<FinanceSettings>): Promise<Answer<FinanceSettings>> =>
  change('/api/admin/settings', 'PUT', settings);

export type CostInput = Pick<FixedCost, 'label' | 'amount' | 'currency' | 'period' | 'active'>;

export const addCost = (cost: CostInput): Promise<Answer<object>> => change('/api/admin/fixed-costs', 'POST', cost);

export const updateCost = (id: number, cost: CostInput): Promise<Answer<object>> =>
  change(`/api/admin/fixed-costs/${id}`, 'PATCH', cost);

export const removeCost = (id: number): Promise<Answer<object>> => change(`/api/admin/fixed-costs/${id}`, 'DELETE');

export const fetchAffiliates = (): Promise<{ affiliates: Affiliate[]; payouts: Payout[]; linkBase: string } | null> =>
  ask('/api/admin/affiliates');

export type AffiliateInput = { name: string; code: string; email: string; rate: number; months: number; note: string };

export const createAffiliate = (input: AffiliateInput): Promise<Answer<{ id: string }>> =>
  change('/api/admin/affiliates', 'POST', input);

export const updateAffiliate = (id: string, changes: Partial<AffiliateInput> & { active?: boolean }): Promise<Answer<object>> =>
  change(`/api/admin/affiliates/${encodeURIComponent(id)}`, 'PATCH', changes);

export const recordPayout = (id: string, pounds: number, note: string): Promise<Answer<object>> =>
  change(`/api/admin/affiliates/${encodeURIComponent(id)}/payouts`, 'POST', { pounds, note });
