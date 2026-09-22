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
import { query } from './db';
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
 * Write, unless somebody got there first.
 *
 * The version is the whole of the concurrency story. A client sends the
 * version it last saw; if the row has moved on, the write is refused and the
 * newer diary comes back instead. Without it, two phones open at once means
 * whichever closes last silently erases the other's afternoon.
 *
 * It is deliberately not a merge. Merging two food diaries by machine means
 * guessing whether two similar lunches are one lunch logged twice or two
 * lunches, and there is no answer to that which is right often enough to
 * apply silently. Refusing and handing back the other version leaves the
 * decision where it can be made.
 */
export async function writeDiary(owner: string, state: unknown, expected: number | null): Promise<WriteResult> {
  const size = JSON.stringify(state ?? null).length;
  if (size > MAX_BYTES) return { ok: false, reason: 'too_big', size, limit: MAX_BYTES };

  // A first write has nothing to conflict with; after that the version has to
  // match. Both cases are one statement so nothing can slip between a check
  // and a write.
  if (expected === null) {
    const rows = await query<{ version: string; updated_at: Date }>(
      `insert into diaries (owner_id, state) values ($1, $2)
       on conflict (owner_id) do nothing
       returning version, updated_at`,
      [owner, state],
    );
    if (rows[0]) return { ok: true, version: Number(rows[0].version), updatedAt: rows[0].updated_at.toISOString() };
    return { ok: false, reason: 'stale', current: (await readDiary(owner))! };
  }

  const rows = await query<{ version: string; updated_at: Date }>(
    `update diaries set state = $2, version = version + 1, updated_at = now()
     where owner_id = $1 and version = $3
     returning version, updated_at`,
    [owner, state, expected],
  );
  if (rows[0]) return { ok: true, version: Number(rows[0].version), updatedAt: rows[0].updated_at.toISOString() };

  const current = await readDiary(owner);
  // No row at all means the expected version was invented, which is a client
  // bug rather than a conflict — but handing back "there is nothing here" is
  // still the useful answer, and the client will write as a first write.
  return { ok: false, reason: 'stale', current: current ?? { state: null, version: 0, updatedAt: new Date(0).toISOString() } };
}

/** Everything belonging to an owner, for account deletion. */
export async function deleteDiary(owner: string): Promise<void> {
  await query('delete from diaries where owner_id = $1', [owner]);
}
