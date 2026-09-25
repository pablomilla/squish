/**
 * Squads: up to five friends encouraging each other.
 *
 * What a member shares is small and chosen for being harmless: a first name,
 * a streak, whether they have logged today, how many days this week, the
 * badges they have earned, and how their Squish looks. Never meals, calories
 * or weight. It is reported by their own app (`POST /api/squad/status`) — it
 * is theirs to share, and it is only ever cosmetic, so there is nothing to
 * gain by fibbing.
 *
 * What members can say to each other is a fixed list of cheers
 * (src/lib/cheers.ts). The squad's name is picked from a list. A display name
 * is letters only, twenty at most. So there is no free text between people
 * anywhere in here — see the note in cheers.ts for why.
 *
 * Anybody can leave at any time, and anybody can block anybody: the two then
 * never see each other or each other's cheers, in this squad or any other,
 * and a blocked person cannot join a squad their blocker is in.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { migrate, query, transaction } from './db';
import { CHEERS, SQUAD_MAX, SQUAD_NAMES, SQUAD_WEEK_GOAL, cheerById, tidyDisplayName } from '../src/lib/cheers';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 7 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
export const tidySquadCode = (code: unknown): string => (typeof code === 'string' ? code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

/** Cheers one person can send in a day, across everybody. */
const DAILY_CHEERS = 20;

export type SquadProblem = 'already_in' | 'not_found' | 'full' | 'bad_name' | 'bad_status' | 'not_in' | 'bad_cheer' | 'too_many' | 'sent_already';

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

export interface SquadView {
  id: string;
  name: string;
  code: string;
  goal: number;
  weeksWon: number;
  lastWonWeek: string | null;
  members: SquadMember[];
  /** Cheers to me not yet seen, oldest first. */
  cheers: { id: string; from: string; fromId: string; cheer: string; sentAt: string }[];
  /** What I have sent today, so the same cheer is not offered twice to one person. */
  sentToday: { to: string; cheer: string }[];
  sentTodayCount: number;
  dailyCheers: number;
}

const memberOf = async (accountId: string) =>
  (await query<{ id: string; squad_id: string }>('select id, squad_id from squad_members where account_id = $1', [accountId]))[0] ?? null;

/** Everybody this account has blocked or been blocked by. */
const blockedWith = async (accountId: string): Promise<Set<string>> =>
  new Set(
    (
      await query<{ other: string }>(
        `select blocked_id as other from squad_blocks where blocker_id = $1
         union select blocker_id from squad_blocks where blocked_id = $1`,
        [accountId],
      )
    ).map((row) => row.other),
  );

export async function squadFor(accountId: string): Promise<SquadView | null> {
  await migrate();
  const me = await memberOf(accountId);
  if (!me) return null;
  const blocked = await blockedWith(accountId);

  const [squad, members, cheers, sent] = await Promise.all([
    query<{ id: string; name: string; code: string; weeks_won: number; last_won_week: string | null }>(
      'select id, name, code, weeks_won, last_won_week from squads where id = $1',
      [me.squad_id],
    ),
    query<{
      id: string;
      account_id: string;
      display_name: string;
      streak: number;
      logged_day: string | null;
      week_key: string | null;
      week_days: number;
      badges: string[];
      look: string | null;
      outfit: Record<string, string>;
    }>('select * from squad_members where squad_id = $1 order by joined_at', [me.squad_id]),
    query<{ id: string; from_member: string; cheer: string; sent_at: Date; from_account: string; from_name: string }>(
      `select c.id::text, c.from_member, c.cheer, c.sent_at, m.account_id as from_account, m.display_name as from_name
         from squad_cheers c join squad_members m on m.id = c.from_member
        where c.to_member = $1 and c.seen_at is null order by c.sent_at`,
      [me.id],
    ),
    query<{ to_member: string; cheer: string }>(
      `select to_member, cheer from squad_cheers where from_member = $1 and sent_at >= date_trunc('day', now())`,
      [me.id],
    ),
  ]);
  const row = squad[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    goal: SQUAD_WEEK_GOAL,
    weeksWon: row.weeks_won,
    lastWonWeek: row.last_won_week,
    members: members
      .filter((m) => m.account_id === accountId || !blocked.has(m.account_id))
      .map((m) => ({
        id: m.id,
        name: m.display_name,
        streak: m.streak,
        loggedDay: m.logged_day,
        weekKey: m.week_key,
        weekDays: m.week_days,
        badges: m.badges,
        look: m.look,
        outfit: m.outfit ?? {},
        isMe: m.account_id === accountId,
      })),
    cheers: cheers
      .filter((c) => !blocked.has(c.from_account))
      .map((c) => ({ id: c.id, from: c.from_name, fromId: c.from_member, cheer: c.cheer, sentAt: c.sent_at.toISOString() })),
    sentToday: sent.map((s) => ({ to: s.to_member, cheer: s.cheer })),
    sentTodayCount: sent.length,
    dailyCheers: DAILY_CHEERS,
  };
}

type Done<T = object> = ({ ok: true } & T) | { ok: false; problem: SquadProblem };

export async function createSquad(accountId: string, name: unknown, displayName: unknown): Promise<Done<{ code: string }>> {
  await migrate();
  const who = tidyDisplayName(displayName);
  if (!who || typeof name !== 'string' || !(SQUAD_NAMES as readonly string[]).includes(name)) return { ok: false, problem: 'bad_name' };
  if (await memberOf(accountId)) return { ok: false, problem: 'already_in' };

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    try {
      await transaction(async (client) => {
        const id = randomUUID();
        await client.query('insert into squads (id, name, code) values ($1, $2, $3)', [id, name, code]);
        await client.query('insert into squad_members (id, squad_id, account_id, display_name) values ($1, $2, $3, $4)', [
          randomUUID(),
          id,
          accountId,
          who,
        ]);
      });
      return { ok: true, code };
    } catch (error) {
      const pg = error as { code?: string; constraint?: string };
      if (pg.code === '23505' && pg.constraint === 'squads_code_key') continue;
      if (pg.code === '23505') return { ok: false, problem: 'already_in' };
      throw error;
    }
  }
  throw new Error('Could not find a free squad code');
}

export async function joinSquad(accountId: string, code: unknown, displayName: unknown): Promise<Done<{ name: string }>> {
  await migrate();
  const who = tidyDisplayName(displayName);
  if (!who) return { ok: false, problem: 'bad_name' };
  const tidy = tidySquadCode(code);
  if (!tidy) return { ok: false, problem: 'not_found' };
  if (await memberOf(accountId)) return { ok: false, problem: 'already_in' };

  return transaction(async (client) => {
    const squad = (await client.query<{ id: string; name: string }>('select id, name from squads where code = $1 for update', [tidy])).rows[0];
    if (!squad) return { ok: false, problem: 'not_found' } as const;
    const members = (await client.query<{ account_id: string }>('select account_id from squad_members where squad_id = $1', [squad.id])).rows;
    if (members.length >= SQUAD_MAX) return { ok: false, problem: 'full' } as const;
    // Somebody in there has blocked them, or they blocked somebody in there:
    // answered as if the code were wrong, so a block is not announced.
    const blocked = await blockedWith(accountId);
    if (members.some((m) => blocked.has(m.account_id))) return { ok: false, problem: 'not_found' } as const;
    try {
      await client.query('insert into squad_members (id, squad_id, account_id, display_name) values ($1, $2, $3, $4)', [
        randomUUID(),
        squad.id,
        accountId,
        who,
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return { ok: false, problem: 'already_in' } as const;
      throw error;
    }
    return { ok: true, name: squad.name } as const;
  });
}

/** Leave; the last one out takes the squad with them. */
export async function leaveSquad(accountId: string): Promise<void> {
  await migrate();
  await transaction(async (client) => {
    const gone = (await client.query<{ squad_id: string }>('delete from squad_members where account_id = $1 returning squad_id', [accountId])).rows[0];
    if (!gone) return;
    await client.query('delete from squads where id = $1 and not exists (select 1 from squad_members where squad_id = $1)', [gone.squad_id]);
  });
}

export async function renameMe(accountId: string, displayName: unknown): Promise<Done> {
  const who = tidyDisplayName(displayName);
  if (!who) return { ok: false, problem: 'bad_name' };
  const rows = await query('update squad_members set display_name = $2 where account_id = $1 returning 1', [accountId, who]);
  return rows.length ? { ok: true } : { ok: false, problem: 'not_in' };
}

export interface Status {
  streak: number;
  loggedDay: string;
  weekKey: string;
  weekDays: number;
  badges: string[];
  look: string;
  outfit: Record<string, string>;
}

const ID = /^[a-z0-9-]{1,32}$/;

/** What the app says about its person. Anything malformed is dropped, not stored. */
export function tidyStatus(raw: unknown): Status | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const int = (value: unknown, max: number) => (Number.isInteger(value) && (value as number) >= 0 ? Math.min(value as number, max) : null);
  const streak = int(r.streak, 100_000);
  const weekDays = int(r.weekDays, 7);
  if (streak === null || weekDays === null) return null;
  if (typeof r.loggedDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.loggedDay)) return null;
  if (typeof r.weekKey !== 'string' || !/^\d{4}-W\d{2}$/.test(r.weekKey)) return null;
  const badges = Array.isArray(r.badges) ? r.badges.filter((b): b is string => typeof b === 'string' && ID.test(b)).slice(0, 40) : [];
  const look = typeof r.look === 'string' && ID.test(r.look) ? r.look : 'squish';
  const outfit: Record<string, string> = {};
  if (r.outfit && typeof r.outfit === 'object') {
    for (const slot of ['head', 'face', 'neck']) {
      const item = (r.outfit as Record<string, unknown>)[slot];
      if (typeof item === 'string' && ID.test(item)) outfit[slot] = item;
    }
  }
  return { streak, loggedDay: r.loggedDay, weekKey: r.weekKey, weekDays, badges, look, outfit };
}

/**
 * Record a member's status, and check the squad's weekly goal: everybody —
 * at least two of them — logging on `SQUAD_WEEK_GOAL` days in the same week.
 * Counted once per week, however many times it is checked.
 */
export async function setStatus(accountId: string, raw: unknown): Promise<Done<{ wonNow: boolean }>> {
  const status = tidyStatus(raw);
  if (!status) return { ok: false, problem: 'bad_status' };
  const rows = await query<{ squad_id: string }>(
    `update squad_members set streak = $2, logged_day = $3, week_key = $4, week_days = $5, badges = $6, look = $7, outfit = $8, status_at = now()
      where account_id = $1 returning squad_id`,
    [accountId, status.streak, status.loggedDay, status.weekKey, status.weekDays, status.badges, status.look, JSON.stringify(status.outfit)],
  );
  const squadId = rows[0]?.squad_id;
  if (!squadId) return { ok: false, problem: 'not_in' };

  const won = await query(
    `update squads set weeks_won = weeks_won + 1, last_won_week = $2
      where id = $1 and last_won_week is distinct from $2
        and (select count(*) from squad_members where squad_id = $1) >= 2
        and not exists (select 1 from squad_members where squad_id = $1 and (week_key is distinct from $2 or week_days < $3))
      returning 1`,
    [squadId, status.weekKey, SQUAD_WEEK_GOAL],
  );
  return { ok: true, wonNow: won.length > 0 };
}

export async function sendCheer(accountId: string, toMember: unknown, cheerId: unknown): Promise<Done> {
  if (typeof cheerId !== 'string' || !cheerById(cheerId)) return { ok: false, problem: 'bad_cheer' };
  if (typeof toMember !== 'string') return { ok: false, problem: 'not_found' };
  const me = await memberOf(accountId);
  if (!me) return { ok: false, problem: 'not_in' };

  const to = (
    await query<{ id: string; account_id: string }>('select id, account_id from squad_members where id = $1 and squad_id = $2', [
      toMember,
      me.squad_id,
    ])
  )[0];
  if (!to || to.account_id === accountId || (await blockedWith(accountId)).has(to.account_id)) return { ok: false, problem: 'not_found' };

  const today = await query<{ n: number; same: number }>(
    `select count(*)::int as n, count(*) filter (where to_member = $2 and cheer = $3)::int as same
       from squad_cheers where from_member = $1 and sent_at >= date_trunc('day', now())`,
    [me.id, to.id, cheerId],
  );
  if ((today[0]?.same ?? 0) > 0) return { ok: false, problem: 'sent_already' };
  if ((today[0]?.n ?? 0) >= DAILY_CHEERS) return { ok: false, problem: 'too_many' };

  await query('insert into squad_cheers (squad_id, from_member, to_member, cheer) values ($1, $2, $3, $4)', [me.squad_id, me.id, to.id, cheerId]);
  return { ok: true };
}

/** Cheers read: marked so they are only announced once. Only one's own. */
export async function markCheersSeen(accountId: string, ids: unknown): Promise<void> {
  const me = await memberOf(accountId);
  if (!me || !Array.isArray(ids)) return;
  const wanted = ids.filter((id): id is string => typeof id === 'string' && /^\d{1,18}$/.test(id)).slice(0, 100);
  if (!wanted.length) return;
  await query('update squad_cheers set seen_at = now() where to_member = $1 and id = any($2::bigint[]) and seen_at is null', [me.id, wanted]);
}

/**
 * Block a member: from now on neither sees the other, anywhere. The blocker
 * stays in the squad; the blocked person is not told.
 */
export async function blockMember(accountId: string, memberId: unknown): Promise<Done> {
  if (typeof memberId !== 'string') return { ok: false, problem: 'not_found' };
  const me = await memberOf(accountId);
  if (!me) return { ok: false, problem: 'not_in' };
  const them = (
    await query<{ account_id: string }>('select account_id from squad_members where id = $1 and squad_id = $2', [memberId, me.squad_id])
  )[0];
  if (!them || them.account_id === accountId) return { ok: false, problem: 'not_found' };
  await query('insert into squad_blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing', [accountId, them.account_id]);
  return { ok: true };
}

export { CHEERS, SQUAD_NAMES };
