/**
 * Inviting friends, from the app's side: this account's invite link and how
 * it is doing, and whether the link somebody arrived by was a friend's.
 *
 * The rules live on the server (server/friends.ts): a month of Plus each, once
 * the friend has verified their address and used Squish on three different
 * days. Nothing here decides anything; it only asks and shows.
 */
import { apiUrl } from './origin';
import { deviceToken } from './identity';
import { referral } from './referral';

export interface Friends {
  code: string;
  link: string;
  rewardDays: number;
  qualifyDays: number;
  cap: number;
  joined: number;
  rewarded: number;
  daysEarned: number;
  capLeft: number;
  /** Friends who got going since this was last asked, to say well done once. */
  fresh: number;
  mine: { rewarded: boolean; daysUsed: number; verified: boolean } | null;
  /** What an inviter already on Plus gets straight away. */
  boost: { photo: number; chat: number; days: number };
  /** Extra AI from invites still running, and until when (ISO). */
  extra: { photo: number; chat: number; until: string } | null;
  /** When their Plus runs to, saved months included (ISO). */
  plusUntil: string | null;
}

export interface FriendOffer {
  rewardDays: number;
  qualifyDays: number;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const token = await deviceToken(apiUrl);
    const response = await fetch(apiUrl(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** This account's invites, or null when signed out or out of reach. */
export const fetchFriends = ({ peek = false } = {}): Promise<Friends | null> => get<Friends>(`/api/friends${peek ? '?peek=1' : ''}`);

let once: Promise<Friends | null> | null = null;

/**
 * The same, asked at most once a visit — for Home, which only needs to know
 * whether this person is an invited friend still on their way to the reward.
 */
export function friendsThisVisit(): Promise<Friends | null> {
  // A peek: the well-done is left for the invite card to say properly.
  once ??= fetchFriends({ peek: true });
  return once;
}

let offer: Promise<FriendOffer | null> | null = null;

/**
 * Whether this browser arrived by a friend's invite, and what it offers. Asked
 * once per visit; a code that is an affiliate's, or nobody's, is no offer.
 */
export function friendOffer(): Promise<FriendOffer | null> {
  const code = referral();
  if (!code) return Promise.resolve(null);
  offer ??= get<{ friend: boolean } & FriendOffer>(`/api/friend-code/${encodeURIComponent(code)}`).then((found) =>
    found?.friend ? { rewardDays: found.rewardDays, qualifyDays: found.qualifyDays } : null,
  );
  return offer;
}

/** "a month" for 30 days, which is what it will nearly always be; "3 months" for 90. */
export function periodWords(days: number): string {
  if (days > 0 && days % 30 === 0) return days === 30 ? 'a month' : `${days / 30} months`;
  if (days > 0 && days % 7 === 0) return days === 7 ? 'a week' : `${days / 7} weeks`;
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** What goes with a shared card or link, invite included. */
export const inviteText = (friends: Pick<Friends, 'rewardDays'>, lead?: string): string =>
  `${lead ? `${lead} ` : ''}Join me on Squish and we both get ${periodWords(friends.rewardDays)} of Squish Plus:`;

/**
 * Hand the invite to the phone's share sheet, or copy it where there is none.
 * Says which happened, so the caller can tell the person.
 */
export async function shareInvite(friends: Pick<Friends, 'link' | 'rewardDays'>): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const text = inviteText(friends);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Squish', text, url: friends.link });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${friends.link}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}
