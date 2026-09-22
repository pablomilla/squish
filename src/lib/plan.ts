/**
 * Which tier this person is on, as far as the browser is allowed to know.
 *
 * The answer always comes from the server and is never written down here.
 * That is the whole design: a `subscribed: true` in localStorage is a line in
 * a file anybody can edit, and a paywall a devtools console defeats funds
 * nothing. What this module holds is a cache of what the server last said,
 * in memory, gone on reload.
 *
 * It fails closed on the money and open on the person. If the check cannot be
 * made — offline, server asleep, no database at all — the answer is `free`,
 * so nothing unpaid is handed out. What it must never do is take anything
 * away: the diary, the charts and the meals logged by hand do not consult
 * this, and a Squish with no server behind it is a perfectly good food diary.
 */
import { apiUrl } from './origin';
import { deviceToken } from './identity';

export type Plan = 'free' | 'plus';
export type Billable = 'photo' | 'chat' | 'recipe';

export interface Standing {
  /** False until the server has answered once. */
  known: boolean;
  plan: Plan;
  used: Record<Billable, number>;
  allowance: Record<Billable, number>;
  left: Record<Billable, number>;
  /** ISO date the month rolls over, where the server said. */
  resets: string | null;
  /** True where this Squish keeps nothing, so there are no tiers at all. */
  off: boolean;
  /** True where invite codes exist, so the app knows whether to offer the box. */
  invites: boolean;
  /** Whether this device is signed in, as the server sees it. */
  account: boolean;
  /**
   * Whether the server will serve this person the dashboard.
   *
   * Only ever used to decide whether to show the way in. The routes
   * themselves answer 404 to everybody else, so this is a convenience and
   * never the lock.
   */
  admin: boolean;
}

const NONE: Record<Billable, number> = { photo: 0, chat: 0, recipe: 0 };

/** Free, and knowing nothing: what everything starts as and falls back to. */
const UNKNOWN: Standing = { known: false, plan: 'free', used: NONE, allowance: NONE, left: NONE, resets: null, off: false, invites: false, account: false, admin: false };

let standing: Standing = UNKNOWN;
const listeners = new Set<(standing: Standing) => void>();

export const planNow = (): Standing => standing;

/** True only when the server has said so. Used for the Plus colourways. */
export const isSubscribed = (): boolean => standing.plan === 'plus';

export function watchStanding(listener: (standing: Standing) => void): () => void {
  listeners.add(listener);
  listener(standing);
  return () => listeners.delete(listener);
}

function announce(next: Standing): void {
  standing = next;
  for (const listener of listeners) listener(next);
}

/** Ask the server. Safe to call whenever something might have changed it. */
export async function refreshPlan(): Promise<Standing> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl('/api/allowance'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) return standing;

    const body = (await response.json()) as Partial<Standing> & { known?: boolean };
    if (!body.known) {
      announce({ ...UNKNOWN, known: true, off: true });
      return standing;
    }
    announce({
      known: true,
      off: false,
      plan: body.plan === 'plus' ? 'plus' : 'free',
      used: { ...NONE, ...body.used },
      allowance: { ...NONE, ...body.allowance },
      left: { ...NONE, ...body.left },
      resets: body.resets ?? null,
      invites: Boolean(body.invites),
      account: Boolean(body.account),
      admin: Boolean(body.admin),
    });
  } catch {
    // Left as it was. An unreachable server is not evidence that somebody
    // stopped paying, and it is certainly not a reason to start charging
    // them again mid-session.
  }
  return standing;
}

/**
 * Keep it roughly current while the app is open.
 *
 * Re-asked when the tab comes back, because the most likely thing to have
 * happened while it was away is a subscription starting or lapsing. Not
 * polled: a subscription is not the sort of thing that changes on a timer,
 * and a request a minute for the life of the app is rude.
 */
export function watchPlan(enabled: boolean): () => void {
  if (!enabled) {
    announce({ ...UNKNOWN, known: true, off: true });
    return () => {};
  }

  void refreshPlan();

  const onShow = () => {
    if (document.visibilityState === 'visible') void refreshPlan();
  };
  document.addEventListener('visibilitychange', onShow);
  return () => document.removeEventListener('visibilitychange', onShow);
}

/** What the tier is called, in the one place that decides it. */
export { PLUS } from './subscription';

export type RedeemResult = { ok: true; until: string } | { ok: false; message: string };

/**
 * Hand a code to the server.
 *
 * Nothing is decided here: the code is checked against the environment on the
 * server and the account's expiry is moved there. All this does is ask, and
 * then re-read the standing so the app updates without a reload.
 */
export async function redeemInvite(code: string): Promise<RedeemResult> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl('/api/invite'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ code }),
    });
    const body = (await response.json().catch(() => ({}))) as { until?: string; message?: string };

    if (!response.ok) return { ok: false, message: body.message ?? 'That did not work. Try again in a moment.' };
    await refreshPlan();
    return { ok: true, until: body.until ?? '' };
  } catch {
    return { ok: false, message: 'Could not reach Squish just now.' };
  }
}
