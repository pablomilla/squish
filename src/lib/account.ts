/**
 * The account, from the browser's side.
 *
 * Thin on purpose. Every decision worth making — whether a diary moves, what a
 * wrong password is allowed to reveal, when a reset link dies — is made on the
 * server, because those are the answers that have to be the same for everybody
 * and cannot be argued with by editing some JavaScript. This is what asks.
 *
 * It exists at all only where the server keeps things. With no database there
 * are no accounts, the screens do not offer one, and nothing here is called.
 */
import { apiUrl } from './origin';
import { deviceToken } from './identity';
import { switchedIdentity } from './autobackup';
import { refreshPlan } from './plan';
import { forgetReferral, referral } from './referral';
import { t } from './i18n';

export interface Who {
  signedIn: boolean;
  email?: string;
  /** How many devices besides this one are signed in. */
  otherDevices?: number;
  /** Whether the address has been confirmed by following a link. */
  verified?: boolean;
  /** Whether this Squish can send email at all. Nothing about confirming is shown where it cannot. */
  mailReady?: boolean;
}

/** What the server says went wrong, in words meant for a person. */
export interface Trouble {
  ok: false;
  message: string;
}

export type Done<T> = ({ ok: true } & T) | Trouble;

const SOMETHING = t('Could not reach Squish just now. Try again in a moment.');

async function headers(): Promise<Record<string, string>> {
  const token = await deviceToken(apiUrl);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function ask<T>(method: string, path: string, body?: unknown): Promise<Done<T>> {
  try {
    const response = await fetch(apiUrl(path), {
      method,
      headers: await headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json().catch(() => null)) as (T & { message?: string }) | null;

    if (!response.ok) return { ok: false, message: payload?.message ? t(payload.message) : SOMETHING };
    return { ok: true, ...(payload as T) };
  } catch {
    return { ok: false, message: SOMETHING };
  }
}

/** Who this browser is, as far as the server is concerned. */
export async function whoAmI(): Promise<Who> {
  const answer = await ask<Who>('GET', '/api/account');
  return answer.ok
    ? {
        signedIn: answer.signedIn,
        email: answer.email,
        otherDevices: answer.otherDevices,
        verified: answer.verified,
        mailReady: answer.mailReady,
      }
    : { signedIn: false };
}

export interface Arrived {
  email?: string;
  /**
   * Whether the diary on this device became the account's.
   *
   * False means the account already had one, which is not a failure but is a
   * decision somebody has to make — the backup card will say so rather than
   * either diary being touched.
   */
  broughtDiary?: boolean;
  /** True where a confirmation link has been sent to the new address. */
  verificationSent?: boolean;
}

/**
 * Signing in or up changes which diary the server considers this device's, so
 * whatever version this browser last agreed about no longer refers to
 * anything. Forgetting it means the next backup either starts cleanly or is
 * told there is already a diary there — and being told is the whole point.
 */
async function enter(path: string, email: string, password: string, ref?: string): Promise<Done<Arrived>> {
  const answer = await ask<Arrived>('POST', path, ref ? { email, password, ref } : { email, password });
  if (answer.ok) {
    if (ref) forgetReferral();
    switchedIdentity();
    // The tier hangs off the account, so signing in or up can change it —
    // and anything on screen that asks whether there is an account at all is
    // reading the same answer. Without this the app believed you were still
    // signed out until the tab lost focus and came back.
    await refreshPlan();
  }
  return answer;
}

export const signUp = (email: string, password: string): Promise<Done<Arrived>> =>
  enter('/api/account', email, password, referral());
export const signIn = (email: string, password: string): Promise<Done<Arrived>> => enter('/api/session', email, password);

export async function signOut(): Promise<Done<Record<string, never>>> {
  const answer = await ask<Record<string, never>>('DELETE', '/api/session');
  if (answer.ok) {
    switchedIdentity();
    await refreshPlan();
  }
  return answer;
}

export const changePassword = (current: string, next: string): Promise<Done<Record<string, never>>> =>
  ask('POST', '/api/account/password', { current, next });

export async function deleteAccount(password: string): Promise<Done<Record<string, never>>> {
  const answer = await ask<Record<string, never>>('DELETE', '/api/account', { password });
  // The device is detached rather than deleted, so it goes back to owning its
  // own diary on the server — a different one, which is a switch like any
  // other.
  if (answer.ok) {
    switchedIdentity();
    await refreshPlan();
  }
  return answer;
}

/** Always reports success, whether or not that address has an account. */
export const requestReset = (email: string): Promise<Done<Record<string, never>>> =>
  ask('POST', '/api/account/reset', { email });

export const completeReset = (token: string, password: string): Promise<Done<Record<string, never>>> =>
  ask('POST', '/api/account/reset/confirm', { token, password });

/** The token out of a reset link, where this page was opened from one. */
export function resetTokenInUrl(): string | null {
  try {
    if (!location.pathname.startsWith('/reset')) return null;
    return new URLSearchParams(location.search).get('token');
  } catch {
    return null;
  }
}

/** Once the link has been used, the URL should stop carrying a live token. */
export function clearResetUrl(): void {
  try {
    history.replaceState(null, '', '/');
  } catch {
    /* nothing to do */
  }
}

/** Cut every other device loose. The password again, because this is a lock. */
export const signOutEverywhere = (password: string): Promise<Done<{ signedOut?: number }>> =>
  ask('POST', '/api/account/devices/forget', { password });

/** Send the confirmation link again. */
export const resendVerification = (): Promise<Done<{ result?: 'sent' | 'already' }>> =>
  ask('POST', '/api/account/verify');

/* ---------------- Asking for an account from elsewhere ---------------- */

/**
 * The paywall asks for an account ("your first five are on us"), but the form
 * lives on the You screen, which may not have been opened yet. So the ask is
 * remembered until the account card is there to take it.
 */
let accountAsked = false;
const askListeners = new Set<() => void>();

export function askForAccount(): void {
  accountAsked = true;
  for (const listener of askListeners) listener();
}

/** Called by the account card: runs `open` now if an ask is waiting, and on any later one. */
export function onAccountAsked(open: () => void): () => void {
  const take = () => {
    if (!accountAsked) return;
    accountAsked = false;
    open();
  };
  askListeners.add(take);
  take();
  return () => askListeners.delete(take);
}
