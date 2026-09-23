/**
 * The partner page's side of the wire.
 *
 * A partner is not an app account and this browser's device token is never
 * sent: the partner page has its own session, kept here, and nothing else.
 */
import { apiUrl } from './origin';

const KEY = 'squish-partner';

export interface PartnerView {
  name: string;
  code: string;
  link: string;
  rate: number;
  months: number;
  active: boolean;
  since: string;
  totals: { clicks: number; signups: number; paying: number; revenuePence: number; earnedPence: number; paidPence: number; owedPence: number };
  days: { day: string; clicks: number; signups: number }[];
  byMonth: { month: string; signups: number; earnedPence: number }[];
  payouts: { amountPence: number; paidAt: string; note: string | null }[];
}

function session(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function keep(value: string | null): void {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // A private window: signed in for as long as the tab is open, which is fine.
  }
}

async function post<T>(path: string, body: unknown, auth?: string | null): Promise<{ ok: true; value: T } | { ok: false; message: string; status: number }> {
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) return { ok: false, message: payload.message ?? 'That did not work.', status: response.status };
    return { ok: true, value: payload };
  } catch {
    return { ok: false, message: 'Could not reach Squish just now.', status: 0 };
  }
}

/** The token from a sign-in link, taken out of the address bar as it is read. */
export function linkTokenInUrl(): string | null {
  try {
    const match = /(?:^|&)token=([^&]+)/.exec(location.hash.slice(1));
    if (!match) return null;
    history.replaceState(history.state, '', location.pathname + location.search);
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export async function claimLink(token: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const done = await post<{ session: string }>('/api/partner/claim', { token });
  if (!done.ok) return done;
  keep(done.value.session);
  return { ok: true };
}

export async function askForLink(email: string): Promise<{ ok: true; mail: boolean } | { ok: false; message: string }> {
  const done = await post<{ mail: boolean }>('/api/partner/link', { email });
  return done.ok ? { ok: true, mail: done.value.mail } : done;
}

export const signedIn = (): boolean => session() !== null;

/** Their figures; null with `signedOut` when the session has gone, so the page can ask them to sign in again. */
export async function fetchMine(): Promise<{ view: PartnerView } | { signedOut: boolean; message?: string }> {
  const token = session();
  if (!token) return { signedOut: true };
  try {
    const response = await fetch(apiUrl('/api/partner/me'), { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) {
      keep(null);
      return { signedOut: true };
    }
    if (!response.ok) return { signedOut: false, message: 'Could not load your figures just now.' };
    return { view: (await response.json()) as PartnerView };
  } catch {
    return { signedOut: false, message: 'Could not reach Squish just now.' };
  }
}

export async function signOut(): Promise<void> {
  await post('/api/partner/signout', {}, session());
  keep(null);
}
