/**
 * Squads, from the app's side: asking the server, keeping one copy of the
 * answer that Home, You and the squad sheet all read, and working out the
 * little status this person shares with their squad.
 *
 * The rules — who sees whom, which cheers exist, how often — are the
 * server's (server/squads.ts). Nothing here decides anything.
 */
import { apiUrl } from './origin';
import { deviceToken } from './identity';
import { addDays, isoDate, parseISO, weekOf } from './date';
import { streakOf } from './selectors';
import { addToInbox, type CheerInbox, type InboxCheer } from './cheerInbox';

export { inboxFor, type CheerInbox, type InboxCheer } from './cheerInbox';
import type { MealEntry, Mood } from '../types';

export interface SquadMember {
  id: string;
  name: string;
  streak: number;
  loggedDay: string | null;
  weekKey: string | null;
  weekDays: number;
  badges: string[];
  look: string | null;
  outfit: Record<string, string>;
  isMe: boolean;
}

export interface Squad {
  id: string;
  name: string;
  code: string;
  link: string;
  goal: number;
  weeksWon: number;
  lastWonWeek: string | null;
  members: SquadMember[];
  cheers: { id: string; from: string; fromId: string; cheer: string; sentAt: string }[];
  sentToday: { to: string; cheer: string }[];
  sentTodayCount: number;
  dailyCheers: number;
}

export type SquadState = { kind: 'unknown' } | { kind: 'none' } | { kind: 'in'; squad: Squad };

let state: SquadState = { kind: 'unknown' };
const listeners = new Set<() => void>();
const announce = (next: SquadState) => {
  state = next;
  for (const listener of listeners) listener();
};
export const squadNow = (): SquadState => state;
export const watchSquad = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

type Answer = { ok: true; squad: Squad | null } | { ok: false; message: string };

async function ask(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Answer> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json().catch(() => null)) as { squad?: Squad | null; message?: string } | null;
    if (!response.ok) return { ok: false, message: payload?.message ?? 'Could not reach your squad just now.' };
    const squad = payload?.squad ?? null;
    announce(squad ? { kind: 'in', squad } : { kind: 'none' });
    return { ok: true, squad };
  } catch {
    return { ok: false, message: 'Could not reach your squad just now.' };
  }
}

export const refreshSquad = () => ask('GET', '/api/squad');
export const startSquad = (name: string, displayName: string) => ask('POST', '/api/squad', { name, displayName });
export const joinSquad = (code: string, displayName: string) => ask('POST', '/api/squad/join', { code, displayName });
export const leaveSquad = async () => {
  const done = await ask('POST', '/api/squad/leave');
  // Cheers from a squad somebody has left are not news any more.
  if (done.ok) clearCheerInbox();
  return done;
};
export const renameInSquad = (displayName: string) => ask('POST', '/api/squad/name', { displayName });
export const sendCheer = (to: string, cheer: string) => ask('POST', '/api/squad/cheer', { to, cheer });
export const blockInSquad = (member: string) => ask('POST', '/api/squad/block', { member });
export const cheersSeen = (ids: string[]) => ask('POST', '/api/squad/seen', { ids });
export const postStatus = (status: SquadStatus) => ask('POST', '/api/squad/status', status);

/** Forget everything when the account goes, so the next person does not see it. */
export const forgetSquad = () => announce({ kind: 'unknown' });

/* ---------- The link a squad is shared by: ?squad=CODE ---------- */

const KEY = 'squish-squad-invite';

/** Take a squad code out of the address and keep it until it can be used. */
export function catchSquadInvite(): void {
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('squad')?.trim().toUpperCase();
    if (!code) return;
    url.searchParams.delete('squad');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (/^[A-Z0-9]{5,12}$/.test(code)) localStorage.setItem(KEY, code);
  } catch {
    // Blocked storage: they can still type the code.
  }
}

export function pendingSquadInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetSquadInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}

/* ---------- What this person shares ---------- */

export interface SquadStatus {
  streak: number;
  /** The last day they logged anything, in their own calendar. */
  loggedDay: string;
  weekKey: string;
  weekDays: number;
  badges: string[];
  look: string;
  outfit: Record<string, string>;
}

/** ISO week, e.g. "2026-W39", for the Monday-first week containing `iso`. */
export function isoWeekKey(iso: string): string {
  const d = parseISO(iso);
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The status for the squad: a streak, the last day logged, days logged this
 * week, badges, and Squish's look. Worked out from the diary here, and
 * nothing from the diary itself leaves — not a meal, a number or a weight.
 */
export function statusFrom(
  meals: MealEntry[],
  unlocked: Record<string, string>,
  look: string,
  outfit: Record<string, string>,
  today = isoDate(),
): SquadStatus {
  const logged = new Set(meals.map((m) => m.date));
  const last = [...logged].filter((d) => d <= today).sort().pop() ?? addDays(today, -3650);
  const week = weekOf(today);
  return {
    streak: streakOf(meals, today),
    loggedDay: last,
    weekKey: isoWeekKey(today),
    weekDays: week.filter((d) => logged.has(d)).length,
    badges: Object.keys(unlocked),
    look,
    outfit,
  };
}

/** Whether a member has logged today, as far as this phone's calendar goes. */
export const loggedToday = (member: Pick<SquadMember, 'loggedDay'>, today = isoDate()) => member.loggedDay === today;

/** How a member's Squish looks: bright if they have logged today, dozing if it has been a while. */
export function memberMood(member: Pick<SquadMember, 'loggedDay' | 'streak'>, today = isoDate()): Mood {
  if (loggedToday(member, today)) return member.streak >= 3 ? 'cheering' : 'excited';
  if (member.loggedDay && member.loggedDay >= addDays(today, -2)) return 'calm';
  return 'sleepy';
}

/* ---------- Today's cheers, kept on this phone so Home can show them ---------- */

/**
 * The server hands a cheer over once and is told it has been seen, so by
 * the time Home draws there is nothing "unread" left to go on. This keeps
 * today's, on the phone, until the squad is opened — which is what lets
 * the squad strip come up to the top of Home while there is a cheer to see,
 * and go back down once it has been.
 */
const INBOX_KEY = 'squish-cheer-inbox';
const inboxListeners = new Set<() => void>();
let inboxCache: CheerInbox | null | undefined;

function readInbox(): CheerInbox | null {
  if (inboxCache !== undefined) return inboxCache;
  try {
    inboxCache = JSON.parse(localStorage.getItem(INBOX_KEY) ?? 'null') as CheerInbox | null;
  } catch {
    inboxCache = null;
  }
  return inboxCache;
}

function writeInbox(next: CheerInbox | null): void {
  inboxCache = next;
  try {
    if (next) localStorage.setItem(INBOX_KEY, JSON.stringify(next));
    else localStorage.removeItem(INBOX_KEY);
  } catch {
    // Blocked storage: the cheer was still said, just not kept.
  }
  for (const listener of inboxListeners) listener();
}

export const cheerInbox = (): CheerInbox | null => readInbox();
export const watchCheerInbox = (listener: () => void): (() => void) => {
  inboxListeners.add(listener);
  return () => inboxListeners.delete(listener);
};
export const keepCheers = (arrived: InboxCheer[], today = isoDate()) => writeInbox(addToInbox(readInbox(), arrived, today));
export const clearCheerInbox = () => writeInbox(null);
