/**
 * Keeping a copy of somebody's diary.
 *
 * A backup, not a source of truth. The diary lives in the browser and always
 * will: that is what makes Squish work on a train, and it is why nobody has to
 * trust us with their food to use it. This is the copy that survives a cleared
 * browser, a lost phone, or a second device.
 *
 * Whose copy it is depends on what there is to go on. A device that has never
 * signed up owns its own; the moment an account exists, the account owns it
 * and every device signed into it shares one. That is what lets somebody use
 * Squish for a month and then sign up without losing a day of it.
 */
import { query, transaction } from './db';
import { applyChange, changeOf, fingerprintOf, stableJson, timesIn, type Change } from '../src/lib/sync';
import { isPastChat, keepGone, mergeChats, withoutGone } from '../src/lib/pastChats';
import type { Device } from './identity';

/** One diary is a persisted zustand store — a few hundred kB with photos. */
const MAX_BYTES = 6_000_000;

export interface Backup {
  state: unknown;
  version: number;
  updatedAt: string;
}

/** An account's if there is one, otherwise the device's own. */
export const ownerOf = (device: Device): string => device.accountId ?? device.id;

export async function readDiary(owner: string): Promise<Backup | null> {
  const rows = await query<{ state: unknown; version: string; updated_at: Date }>(
    'select state, version, updated_at from diaries where owner_id = $1',
    [owner],
  );
  const found = rows[0];
  return found ? { state: found.state, version: Number(found.version), updatedAt: found.updated_at.toISOString() } : null;
}

export type WriteResult =
  | { ok: true; version: number; updatedAt: string }
  /** Somebody else wrote since this client last read. Theirs is returned. */
  | { ok: false; reason: 'stale'; current: Backup }
  /**
   * Too big to keep. A refusal, not a failure — which is the distinction
   * that matters, because the app used to throw here and the person was
   * told they were offline while their network was perfectly fine.
   */
  | { ok: false; reason: 'too_big'; size: number; limit: number };

/**
 * Which version each part of a diary last changed in, kept beside it, so a
 * device can be sent only what changed since the version it has. Worked out
 * on every write by comparing the parts' times before and after, whoever
 * wrote and however (a whole diary or some of its parts).
 *
 * `from` is the version since which that is known: a device further behind
 * is sent the whole diary. It moves on when a deletion is let go of (after
 * four months) — a device that has not heard of it since cannot be told by
 * parts — and when a diary arrives with no times at all, from an app that
 * kept none, which says nothing about what it changed.
 */
interface Tracking {
  versions: Record<string, number>;
  from: number;
}

/** The past chats, which are not parts: their own entry, by a name no part can have. */
const CHATS = '~chats';

function track(before: unknown, after: unknown, was: Tracking | null, oldVersion: number, newVersion: number): Tracking {
  const versions = { ...(was?.versions ?? {}) };
  let from = was?.from ?? oldVersion;
  const then = timesIn(before);
  const now = timesIn(after);
  if (!Object.keys(now).length) from = newVersion;
  for (const [part, entry] of Object.entries(now)) {
    if (stableJson(entry) !== stableJson(then[part])) versions[part] = newVersion;
  }
  for (const [part, version] of Object.entries(versions)) {
    if (part === CHATS || part in now) continue;
    from = Math.max(from, version);
    delete versions[part];
  }
  const chats = (diary: unknown) => fingerprintOf((diary as { pastChats?: unknown } | null)?.pastChats ?? null);
  if (chats(before) !== chats(after)) versions[CHATS] = newVersion;
  return { versions, from };
}

type Row = {
  state: unknown;
  version: string;
  updated_at: Date;
  part_versions: Record<string, number> | null;
  parts_from: string | null;
};

const tracking = (row: Row): Tracking | null =>
  row.parts_from === null ? null : { versions: row.part_versions ?? {}, from: Number(row.parts_from) };

const backupOf = (row: Row): Backup => ({ state: row.state, version: Number(row.version), updatedAt: row.updated_at.toISOString() });

/**
 * Write, unless somebody got there first.
 *
 * The version is the whole of the concurrency story. A client sends the
 * version it last saw; if the row has moved on, the write is refused and the
 * newer diary comes back instead. Without it, two phones open at once means
 * whichever closes last silently erases the other's afternoon.
 *
 * The whole diary, from an app that has never been in step with this one
 * (just signed in) or that has lost track; one in step sends only what
 * changed (patchDiary). Refusing and handing back the other version leaves
 * the decision with the app, which merges what it can and asks where it must.
 */
export async function writeDiary(owner: string, state: unknown, expected: number | null): Promise<WriteResult> {
  const size = JSON.stringify(state ?? null).length;
  if (size > MAX_BYTES) return { ok: false, reason: 'too_big', size, limit: MAX_BYTES };

  // A first write has nothing to conflict with; after that the version has to
  // match. Both cases are one statement so nothing can slip between a check
  // and a write.
  if (expected === null) {
    const rows = await query<{ version: string; updated_at: Date }>(
      `insert into diaries (owner_id, state, parts_from) values ($1, $2, 1)
       on conflict (owner_id) do nothing
       returning version, updated_at`,
      [owner, state],
    );
    if (rows[0]) return { ok: true, version: Number(rows[0].version), updatedAt: rows[0].updated_at.toISOString() };
    return { ok: false, reason: 'stale', current: (await readDiary(owner))! };
  }

  return transaction(async (client) => {
    const found = (await client.query<Row>('select state, version, updated_at, part_versions, parts_from from diaries where owner_id = $1 for update', [owner])).rows[0];
    // No row at all means the expected version was invented, which is a client
    // bug rather than a conflict — but handing back "there is nothing here" is
    // still the useful answer, and the client will write as a first write.
    if (!found) return { ok: false, reason: 'stale', current: { state: null, version: 0, updatedAt: new Date(0).toISOString() } };
    if (Number(found.version) !== expected) return { ok: false, reason: 'stale', current: backupOf(found) };
    const next = expected + 1;
    const kept = track(found.state, state, tracking(found), expected, next);
    const rows = (await client.query<{ version: string; updated_at: Date }>(
      `update diaries set state = $2, version = $3, part_versions = $4, parts_from = $5, updated_at = now()
       where owner_id = $1 returning version, updated_at`,
      [owner, state, next, kept.versions, kept.from],
    )).rows;
    return { ok: true, version: Number(rows[0].version), updatedAt: rows[0].updated_at.toISOString() };
  });
}

/** What changed since a version: the parts, and the past chats if they did. */
export interface Changes {
  version: number;
  updatedAt: string;
  change: Change;
  /** Present when the past chats changed: the list, or null where they are no longer kept. */
  pastChats?: unknown;
}

function changesIn(state: unknown, kept: Tracking, since: number, leaveOut: Set<string> = new Set(), also: string[] = []): Omit<Changes, 'version' | 'updatedAt'> {
  const diary = (state ?? {}) as Record<string, unknown>;
  const keys = new Set(Object.entries(kept.versions).filter(([part, version]) => version > since && part !== CHATS).map(([part]) => part));
  for (const part of also) keys.add(part);
  for (const part of leaveOut) keys.delete(part);
  const change = changeOf(diary, timesIn(diary), keys);
  return (kept.versions[CHATS] ?? 0) > since && !leaveOut.has(CHATS) ? { change, pastChats: diary.pastChats ?? null } : { change };
}

/**
 * What changed since the version a device has: nothing (`same`), the parts
 * that did, or — for a device further behind than the parts are known, or a
 * diary not yet written since they were — the whole diary.
 */
export async function diaryChanges(
  owner: string,
  since: number,
): Promise<{ kind: 'same'; version: number } | ({ kind: 'changes' } & Changes) | { kind: 'whole'; backup: Backup } | null> {
  const head = (await query<{ version: string; parts_from: string | null }>('select version, parts_from from diaries where owner_id = $1', [owner]))[0];
  if (!head) return null;
  const version = Number(head.version);
  if (version === since) return { kind: 'same', version };
  const row = (await query<Row>('select state, version, updated_at, part_versions, parts_from from diaries where owner_id = $1', [owner]))[0];
  if (!row) return null;
  const kept = tracking(row);
  if (!kept || since < kept.from || since > Number(row.version)) return { kind: 'whole', backup: backupOf(row) };
  return { kind: 'changes', version: Number(row.version), updatedAt: row.updated_at.toISOString(), ...changesIn(row.state, kept, since) };
}

export type PatchResult =
  /** Saved; and what other devices changed since `base`, or the whole diary where that is not known. */
  | ({ ok: true } & Changes)
  | { ok: true; version: number; updatedAt: string; whole: Backup }
  /** No diary here (deleted, or never written), or a version from a diary since deleted and begun again. */
  | { ok: false; reason: 'missing' | 'reset' }
  | { ok: false; reason: 'too_big'; size: number; limit: number };

/**
 * Save what changed: the parts a device changed since it last saved, put
 * into the diary here by the same rules a device merges by (applyChange in
 * src/lib/sync.ts). Never refused for being behind — another device having
 * saved since `base` is merged with rather than sent back — and answered
 * with what those other devices changed, so the device is in step after one
 * request. Past chats are merged by their own rules; null means they are no
 * longer kept here.
 */
export async function patchDiary(owner: string, base: number, change: Change, pastChats?: unknown, now = Date.now()): Promise<PatchResult> {
  return transaction(async (client) => {
    const found = (await client.query<Row>('select state, version, updated_at, part_versions, parts_from from diaries where owner_id = $1 for update', [owner])).rows[0];
    if (!found) return { ok: false, reason: 'missing' } as const;
    const version = Number(found.version);
    if (base > version) return { ok: false, reason: 'reset' } as const;

    const stored = (found.state ?? {}) as Record<string, unknown>;
    const applied = applyChange(stored, timesIn(stored), change, now);
    const { pastChats: storedChats, _sync: storedSync } = stored as { pastChats?: unknown; _sync?: Record<string, unknown> };
    const chats =
      pastChats === undefined
        ? storedChats
        : pastChats === null
          ? undefined
          : withoutGone(mergeChats(Array.isArray(storedChats) ? storedChats.filter(isPastChat) : [], pastChats, now), keepGone(applied.diary.chatsGone, now));
    const state: Record<string, unknown> = {
      ...applied.diary,
      ...(chats === undefined ? {} : { pastChats: chats }),
      _sync: { ...(storedSync && typeof storedSync === 'object' ? storedSync : {}), times: applied.times },
    };
    const size = JSON.stringify(state).length;
    if (size > MAX_BYTES) return { ok: false, reason: 'too_big', size, limit: MAX_BYTES } as const;

    const next = version + 1;
    const kept = track(stored, state, tracking(found), version, next);
    const rows = (await client.query<{ updated_at: Date }>(
      `update diaries set state = $2, version = $3, part_versions = $4, parts_from = $5, updated_at = now()
       where owner_id = $1 returning updated_at`,
      [owner, state, next, kept.versions, kept.from],
    )).rows;
    const updatedAt = rows[0].updated_at.toISOString();
    if (base < kept.from) return { ok: true, version: next, updatedAt, whole: { state, version: next, updatedAt } };
    // What the device sent, and is now as it sent it, it already has. What it sent and was not taken — this
    // copy's was later — it is sent back, however long ago that was, so the device does not go on holding its own.
    const leaveOut = new Set(applied.taken);
    if (pastChats !== undefined && fingerprintOf(chats ?? null) === fingerprintOf(pastChats)) leaveOut.add(CHATS);
    const refused = Object.keys(change.times ?? {}).filter((part) => !leaveOut.has(part));
    return { ok: true, version: next, updatedAt, ...changesIn(state, kept, base, leaveOut, refused) };
  });
}

/** Only the version, for a device asking whether anything has changed: cheap enough to ask every few minutes. */
export async function diaryVersion(owner: string): Promise<number> {
  const rows = await query<{ version: string }>('select version from diaries where owner_id = $1', [owner]);
  return rows[0] ? Number(rows[0].version) : 0;
}

/** Everything belonging to an owner, for account deletion. */
export async function deleteDiary(owner: string): Promise<void> {
  await query('delete from diaries where owner_id = $1', [owner]);
}
