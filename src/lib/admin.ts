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
  invites: string[];
  inviteDays: number;
}

export interface Person {
  id: string;
  email: string;
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
