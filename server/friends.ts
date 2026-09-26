/**
 * Invite a friend: they get a month of Squish Plus, and so does whoever sent
 * them, once the friend has properly started.
 *
 * "Properly started" is the whole design. A reward for a sign-up alone is a
 * reward for typing an email address, and free Plus is worth farming — every
 * month of it is real AI spend. So the friend has to:
 *
 * - **verify their address**, which costs a real inbox per fake account, and
 * - **use Squish on three different days**, counted from the server's own
 *   record of the days a device was seen (device_days) since they signed up —
 *   not from the diary, which is whatever the phone says it is. Nobody can
 *   squeeze three calendar days into one afternoon.
 *
 * And the one who invited is capped at a year's worth of months in any 365
 * days. Past that the friend is still rewarded; the inviter just is not.
 *
 * Linking your own second account to your own code is refused where it can be
 * seen: the sign-up happening on a device that was signed in to the inviter.
 * Beyond that, a person with two inboxes, two phones and three days of
 * patience has earned their month.
 *
 * The numbers are environment variables, like the allowances in plan.ts:
 * they are policy, and changing them should not need a deploy.
 *
 * Plus is granted by extending `accounts.plus_until`, the same field the grant
 * script uses. When Plus goes on sale through the App Store and Google Play,
 * a reward for somebody already paying through a store needs the store's own
 * offer mechanism instead — see docs/monetisation.md.
 */
import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { migrate, query, transaction } from './db';
import { compose, originOf } from './emails';
import { canSendMail, sendQuietly } from './mail';
import { readerOf } from './reader';
import { speaker, type Speaker } from '../src/lib/i18n';

const setting = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw >= 0 ? raw : fallback;
};

/** Days of Plus each side gets. */
export const rewardDays = (): number => setting('SQUISH_FRIEND_DAYS', 30);
/** Different days the friend must use Squish on, counting the day they join. */
export const qualifyDays = (): number => setting('SQUISH_FRIEND_QUALIFY_DAYS', 3);
/** Rewards one person can earn by inviting, in any 365 days. */
export const yearlyCap = (): number => setting('SQUISH_FRIEND_CAP', 12);

/** No 0/O, 1/I/L: a code read out over the phone should survive it. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => 'SQ' + Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
export const tidyFriendCode = (code: string): string => code.trim().toUpperCase();
const SHAPE = /^SQ[A-Z0-9]{6}$/;

/** This account's code, made the first time it is asked for. */
export async function friendCodeFor(accountId: string): Promise<string> {
  await migrate();
  const existing = await query<{ friend_code: string | null }>('select friend_code from accounts where id = $1', [accountId]);
  if (existing[0]?.friend_code) return existing[0].friend_code;

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    // Never the same as an affiliate's code: both live under /r/.
    const clash = await query('select 1 from affiliates where code = $1', [code]);
    if (clash.length) continue;
    try {
      const rows = await query<{ friend_code: string }>(
        'update accounts set friend_code = coalesce(friend_code, $2) where id = $1 returning friend_code',
        [accountId, code],
      );
      if (rows[0]) return rows[0].friend_code;
      throw new Error('No such account');
    } catch (error) {
      if ((error as { code?: string }).code === '23505') continue; // taken by somebody else a moment ago
      throw error;
    }
  }
  throw new Error('Could not find a free friend code');
}

/** Whether a code is somebody's invite, for the "a friend invited you" line. */
export async function isFriendCode(code: string): Promise<boolean> {
  const tidy = tidyFriendCode(code);
  if (!SHAPE.test(tidy)) return false;
  await migrate();
  return (await query('select 1 from accounts where friend_code = $1', [tidy])).length > 0;
}

/**
 * Record that a new account came by a friend's invite. Called at sign-up,
 * after the affiliate check, and never allowed to fail it.
 *
 * `deviceWasSignedInTo` is the account the sign-up device belonged to a
 * moment before: somebody signing out of their own account and making a
 * second one with their own code is not a friend.
 */
export async function attributeFriend(friendId: string, code: unknown, deviceWasSignedInTo: string | null): Promise<string | null> {
  if (typeof code !== 'string') return null;
  const tidy = tidyFriendCode(code);
  if (!SHAPE.test(tidy)) return null;
  const rows = await query<{ id: string }>('select id from accounts where friend_code = $1', [tidy]);
  const referrer = rows[0]?.id;
  if (!referrer || referrer === friendId || referrer === deviceWasSignedInTo) return null;
  await query('insert into friend_referrals (friend_id, referrer_id) values ($1, $2) on conflict do nothing', [friendId, referrer]);
  return referrer;
}

/** Different days this account's devices have been seen since it was invited. */
async function daysUsed(friendId: string, since: Date, client?: PoolClient): Promise<number> {
  const sql = `select count(distinct dd.day)::int as days from device_days dd join devices d on d.id = dd.device_id
               where d.account_id = $1 and dd.day >= ($2::timestamptz)::date`;
  const rows = client ? (await client.query<{ days: number }>(sql, [friendId, since])).rows : await query<{ days: number }>(sql, [friendId, since]);
  return rows[0]?.days ?? 0;
}

/** Extra AI for somebody already on Plus, per reward, for this many days. */
export const boost = () => ({
  photo: setting('SQUISH_FRIEND_BOOST_PHOTOS', 20),
  chat: setting('SQUISH_FRIEND_BOOST_CHATS', 10),
  days: setting('SQUISH_FRIEND_BOOST_DAYS', 30),
});

export type RewardKind = 'started' | 'extended';

/**
 * Give one side its reward, fitted to where they are.
 *
 * - **Not on Plus:** Plus starts now, for `days`.
 * - **Already on Plus** (and above all on a yearly plan): a month more at the
 *   far end is a thank-you nobody notices for months. So they get extra AI
 *   now — the thing a subscriber actually runs into — and the month is saved
 *   for when their current Plus ends, by adding it to the end.
 */
async function reward(client: PoolClient, accountId: string, days: number): Promise<{ kind: RewardKind; plusUntil: Date }> {
  const before = await client.query<{ live: boolean }>(
    'select plus_until is not null and plus_until > now() as live from accounts where id = $1 for update',
    [accountId],
  );
  const live = Boolean(before.rows[0]?.live);
  const after = await client.query<{ plus_until: Date }>(
    `update accounts set plus_until = greatest(coalesce(plus_until, now()), now()) + make_interval(days => $2)
      where id = $1 returning plus_until`,
    [accountId, days],
  );
  if (live) {
    const extra = boost();
    await client.query(
      `insert into allowance_boosts (account_id, photo, chat, expires_at, reason)
       values ($1, $2, $3, now() + make_interval(days => $4), 'friend invite')`,
      [accountId, extra.photo, extra.chat, extra.days],
    );
  }
  return { kind: live ? 'extended' : 'started', plusUntil: after.rows[0].plus_until };
}

/**
 * The reward in a sentence, for the email: what they got, and when — in the
 * reader's language, with the date on their own calendar.
 */
export function rewardWords(kind: RewardKind, days: number, plusUntil: Date, words: Speaker = ENGLISH, zone = 'Europe/London'): string {
  const { t } = words;
  const date = (locale: string, timeZone: string) =>
    plusUntil.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone });
  let until: string;
  try {
    until = date(words.locale, zone);
  } catch {
    until = date('en-GB', 'Europe/London');
  }
  if (kind === 'started') return t('We have switched Squish Plus on for you — {days} days of it, until {until}. There is nothing to do.', { days, until });
  const extra = boost();
  return t(
    'As you are already on Plus, you get {photo} extra photo analyses and {chat} extra questions for the nutritionist, for the next {boostDays} days, starting now. And the {days} days of Plus are saved for you, added to the end of your current Plus — it now runs until {until}.',
    { photo: extra.photo, chat: extra.chat, boostDays: extra.days, days, until },
  );
}

const ENGLISH = speaker({ language: 'en', locale: 'en-GB', lookup: () => undefined });

export interface Settled {
  friendDays: number;
  friendKind: RewardKind;
  referrerId: string | null;
  referrerDays: number;
  referrerKind: RewardKind | null;
  referrerPlusUntil: Date | null;
}

/**
 * Give the reward if this account has now earned it for itself and for the
 * one who invited it. Safe to call on every request: it is one indexed read
 * until the day it pays out, and the payout happens once however many
 * requests race to it.
 */
export async function settleFriend(friendId: string, appOrigin?: string): Promise<Settled | null> {
  const pending = await query<{ created_at: Date; verified: boolean }>(
    `select fr.created_at, a.email_verified_at is not null as verified
       from friend_referrals fr join accounts a on a.id = fr.friend_id
      where fr.friend_id = $1 and fr.rewarded_at is null`,
    [friendId],
  );
  const row = pending[0];
  if (!row || !row.verified) return null;
  if ((await daysUsed(friendId, row.created_at)) < qualifyDays()) return null;

  const settled = await transaction(async (client) => {
    const locked = await client.query<{ referrer_id: string | null }>(
      'select referrer_id from friend_referrals where friend_id = $1 and rewarded_at is null for update',
      [friendId],
    );
    if (!locked.rows[0]) return null; // another request got here first
    const referrerId = locked.rows[0].referrer_id;
    const days = rewardDays();

    let referrerDays = 0;
    if (referrerId) {
      const earned = await client.query<{ n: number }>(
        `select count(*)::int as n from friend_referrals
          where referrer_id = $1 and referrer_days > 0 and rewarded_at > now() - interval '365 days'`,
        [referrerId],
      );
      if ((earned.rows[0]?.n ?? 0) < yearlyCap()) referrerDays = days;
    }

    const friend = await reward(client, friendId, days);
    const referrer = referrerId && referrerDays ? await reward(client, referrerId, referrerDays) : null;
    await client.query(
      `update friend_referrals set rewarded_at = now(), friend_days = $2, referrer_days = $3, friend_kind = $4, referrer_kind = $5
        where friend_id = $1`,
      [friendId, days, referrerDays, friend.kind, referrer?.kind ?? null],
    );
    return {
      friendDays: days,
      friendKind: friend.kind,
      referrerId,
      referrerDays,
      referrerKind: referrer?.kind ?? null,
      referrerPlusUntil: referrer?.plusUntil ?? null,
    };
  });

  // Tell the one who invited, by email where there is mail. Their app says
  // so too, the next time they open the invite card.
  //
  // Only to a confirmed address, the same rule as the security notices:
  // otherwise somebody could make an account in a stranger's name, share its
  // invite, and have Squish send that stranger mail. The reward itself does
  // not wait for it — only the email does.
  if (settled?.referrerId && settled.referrerDays && settled.referrerKind && settled.referrerPlusUntil && appOrigin && canSendMail()) {
    const to = await query<{ email: string }>('select email from accounts where id = $1 and email_verified_at is not null', [
      settled.referrerId,
    ]);
    if (to[0]) {
      const link = `${appOrigin}/`;
      const { referrerKind, referrerDays, referrerPlusUntil } = settled;
      const reader = await readerOf(settled.referrerId);
      void compose(
        'friend-reward',
        to[0].email,
        (words) => ({ reward: rewardWords(referrerKind, referrerDays, referrerPlusUntil, words, reader.zone), app_link: link }),
        originOf(link),
        reader,
      )
        .then((mail) => sendQuietly(mail, 'friend reward email'))
        .catch(() => {});
    }
  }
  return settled;
}

export interface FriendsView {
  code: string;
  rewardDays: number;
  qualifyDays: number;
  cap: number;
  /** People who joined with this account's code. */
  joined: number;
  /** Of them, the ones who have got going and earned the reward. */
  rewarded: number;
  /** Days of Plus earned by inviting, all time. */
  daysEarned: number;
  /** Rewards still available in the current 365 days. */
  capLeft: number;
  /** Rewards earned since this was last looked at, to say well done once. */
  fresh: number;
  /** Where this account was itself invited, how that is going. */
  mine: { rewarded: boolean; daysUsed: number; verified: boolean } | null;
  /** What an already-on-Plus inviter gets, so the card can say so. */
  boost: { photo: number; chat: number; days: number };
  /** Extra AI from invites still running, if any, and until when. */
  extra: { photo: number; chat: number; until: string } | null;
  /** When their Plus runs to, saved months included. */
  plusUntil: string | null;
}

/**
 * `peek` reads without spending the well-done: Home looks on every visit, and
 * the celebration belongs to the invite card, which says it properly.
 */
export async function friendsView(accountId: string, { peek = false } = {}): Promise<FriendsView> {
  const code = await friendCodeFor(accountId);
  const [totals, mine, fresh, extras, plus] = await Promise.all([
    query<{ joined: number; rewarded: number; days: number; recent: number }>(
      `select count(*)::int as joined,
              count(rewarded_at)::int as rewarded,
              coalesce(sum(referrer_days), 0)::int as days,
              count(*) filter (where referrer_days > 0 and rewarded_at > now() - interval '365 days')::int as recent
         from friend_referrals where referrer_id = $1`,
      [accountId],
    ),
    query<{ created_at: Date; rewarded: boolean; verified: boolean }>(
      `select fr.created_at, fr.rewarded_at is not null as rewarded, a.email_verified_at is not null as verified
         from friend_referrals fr join accounts a on a.id = fr.friend_id where fr.friend_id = $1`,
      [accountId],
    ),
    // Read and marked in one go, so a well-done is said exactly once.
    peek
      ? query<{ n: number }>(
          `select count(*)::int as n from friend_referrals where referrer_id = $1 and referrer_days > 0 and referrer_seen_at is null`,
          [accountId],
        )
      : query<{ n: number }>(
          `with seen as (
             update friend_referrals set referrer_seen_at = now()
              where referrer_id = $1 and referrer_days > 0 and referrer_seen_at is null returning 1)
           select count(*)::int as n from seen`,
          [accountId],
        ),
    query<{ photo: string; chat: string; until: Date | null }>(
      `select coalesce(sum(photo), 0) as photo, coalesce(sum(chat), 0) as chat, max(expires_at) as until
         from allowance_boosts where account_id = $1 and granted_at <= now() and expires_at > now()`,
      [accountId],
    ),
    query<{ plus_until: Date | null }>('select case when plus_until > now() then plus_until end as plus_until from accounts where id = $1', [accountId]),
  ]);
  const extra = extras[0];
  const t = totals[0] ?? { joined: 0, rewarded: 0, days: 0, recent: 0 };
  const own = mine[0];
  return {
    code,
    rewardDays: rewardDays(),
    qualifyDays: qualifyDays(),
    cap: yearlyCap(),
    joined: t.joined,
    rewarded: t.rewarded,
    daysEarned: t.days,
    capLeft: Math.max(0, yearlyCap() - t.recent),
    fresh: fresh[0]?.n ?? 0,
    mine: own ? { rewarded: own.rewarded, daysUsed: Math.min(await daysUsed(accountId, own.created_at), qualifyDays()), verified: own.verified } : null,
    boost: boost(),
    extra: extra?.until ? { photo: Number(extra.photo), chat: Number(extra.chat), until: extra.until.toISOString() } : null,
    plusUntil: plus[0]?.plus_until ? plus[0].plus_until.toISOString() : null,
  };
}
