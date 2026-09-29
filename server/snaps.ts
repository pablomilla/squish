/**
 * Quick snaps: a meal photographed in a hurry, read in the background.
 *
 * The point of a quick snap is that nobody waits. They tap the widget, take
 * the picture and put the phone away — at a table, in a meeting, somewhere a
 * phone held up for half a minute is rude. A phone that has been put away
 * stops running the app within seconds, and a photo read takes longer than
 * that. So the app hands the photo over (a second or two) and the server
 * reads it whether or not anybody is still looking; the app collects what was
 * read the next time it is open, and logs it for them to check later.
 *
 * A snap is kept only until it is collected: the photo goes as soon as it has
 * been read, the reading as soon as the app has it. One that nobody collects
 * is gone after a week.
 *
 * A read cut off by a deploy is started again by whoever next asks after the
 * device's snaps — the app, which asks as soon as it is opened — and after a
 * few tries it is failed and the photo read given back.
 *
 * Without a database there are no devices to keep snaps for: the app reads
 * the photo itself instead, while it is open (src/lib/snaps.ts).
 */
import type { AnalysisResult, MealSlot } from '../src/types';
import { billedAs } from './billing';
import { hasDatabase, migrate, query } from './db';
import { currentPlace, inPlace, type Place } from './region';

export interface SnapAsk {
  /** Made by the app, so sending the same snap twice (a retry after no signal) keeps one. */
  id: string;
  /** The photo, base64, without the data: prefix. */
  image: string;
  mediaType: string;
  /** When it was taken, on their phone: the meal is logged then, however late it is read. */
  date: string;
  time: string;
  slot?: MealSlot;
  /** Their plate and bowl, for sizing the portions, as a photo read uses them. */
  crockery?: { plateCm?: number; bowlMl?: number };
}

export type SnapStatus = 'working' | 'done' | 'failed';

/** A snap as the app collects it: the reading once there is one, why not when there is not. */
export interface Snap {
  id: string;
  date: string;
  time: string;
  slot?: MealSlot;
  status: SnapStatus;
  analysis?: AnalysisResult;
  error?: string;
}

/** What reading a snap means, set once by the server before any snap arrives. */
export interface SnapWorker {
  read: (ask: SnapAsk) => Promise<AnalysisResult>;
  /** No reading: give the photo read back. Called once per snap, and only for one that was counted. */
  onFail: (deviceId: string) => Promise<void>;
  /** What to tell the person about an error. */
  failure: (error: unknown) => string;
}

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
/** A photo the app has already shrunk to 1024 px is a few hundred kilobytes; this leaves room and no more. */
const MAX_IMAGE = 4_000_000;
/** Unheard from for this long, a read's instance is gone and somebody else may take it. */
export const DEAD_MS = 90_000;
/** Tries in all, the first included. */
export const MAX_ATTEMPTS = 3;
const KEEP_DAYS = 7;

/** The snap as the app sent it, checked; null if it is not one. */
export function cleanSnap(raw: unknown): SnapAsk | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const id = typeof body.id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.id) ? body.id : null;
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const time = typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;
  if (!id || !date || !time || typeof body.image !== 'string') return null;
  const match = body.image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[2].length < 32 || match[2].length > MAX_IMAGE) return null;
  const slot = SLOTS.includes(body.slot as MealSlot) ? (body.slot as MealSlot) : undefined;
  const size = (value: unknown, min: number, max: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
  };
  const cups = (body.crockery ?? {}) as Record<string, unknown>;
  const plateCm = size(cups.plateCm, 15, 40);
  const bowlMl = size(cups.bowlMl, 150, 1500);
  const crockery = plateCm || bowlMl ? { ...(plateCm ? { plateCm } : {}), ...(bowlMl ? { bowlMl } : {}) } : undefined;
  return { id, image: match[2], mediaType: match[1], date, time, ...(slot ? { slot } : {}), ...(crockery ? { crockery } : {}) };
}

let worker: SnapWorker | null = null;
export function setSnapWorker(next: SnapWorker): void {
  worker = next;
}
const theWorker = (): SnapWorker => {
  if (!worker) throw new Error('snaps started before setSnapWorker');
  return worker;
};

/* ------------------------------------------------------------------ *
 * Keeping them. Without a database, in memory: for the tests.
 * ------------------------------------------------------------------ */

type Row = {
  id: string;
  device_id: string;
  ask: Omit<SnapAsk, 'image'>;
  image: string | null;
  place: Place;
  status: SnapStatus;
  analysis: AnalysisResult | null;
  error: string | null;
  attempts: number;
  /** Counted against their photo reads when it arrived: only then is there anything to give back. */
  counted: boolean;
  claimed_at: Date;
  created_at: Date;
};

const memory = new Map<string, Row>();
const keyOf = (deviceId: string, id: string) => `${deviceId}:${id}`;

/** Snap ids are the app's: the same id from two devices is two snaps. */
async function find(deviceId: string, id: string): Promise<Row | null> {
  if (!hasDatabase()) return memory.get(keyOf(deviceId, id)) ?? null;
  await migrate();
  const rows = await query<Row>(`select * from snaps where device_id = $1 and id = $2`, [deviceId, id]);
  return rows[0] ?? null;
}

/** Already sent: a retry of a snap that did arrive is not another photo read. */
export async function knownSnap(deviceId: string, id: string): Promise<boolean> {
  return (await find(deviceId, id)) !== null;
}

/**
 * Take a snap and start reading it. Answers as soon as it is kept; the read
 * goes on without the request. Where they are (for the kitchen, language and
 * diet it is read in) comes from the request, and is kept for a second try.
 */
export async function startSnap(deviceId: string, ask: SnapAsk, counted: boolean, place: Place = currentPlace()): Promise<void> {
  const { image, ...rest } = ask;
  const row: Row = {
    id: ask.id, device_id: deviceId, ask: rest, image, place, status: 'working',
    analysis: null, error: null, attempts: 1, counted, claimed_at: new Date(), created_at: new Date(),
  };
  if (!hasDatabase()) {
    memory.set(keyOf(deviceId, ask.id), row);
  } else {
    await migrate();
    await query(`delete from snaps where created_at < now() - make_interval(days => $1)`, [KEEP_DAYS]).catch(() => {});
    const inserted = await query(
      `insert into snaps (id, device_id, ask, image, place, counted) values ($1, $2, $3, $4, $5, $6) on conflict do nothing returning 1`,
      [ask.id, deviceId, JSON.stringify(rest), image, JSON.stringify(place), counted],
    );
    // Two copies of one snap at once: the first one reads it.
    if (!inserted.length) return;
  }
  read(row, 1);
}

/** Read it, and keep what came of it, if this try still holds the snap. */
function read(row: Row, attempt: number): void {
  const w = theWorker();
  const ask: SnapAsk = { ...row.ask, image: row.image ?? '' };
  void (async () => {
    let outcome: Pick<Row, 'status' | 'analysis' | 'error'>;
    try {
      const analysis = await billedAs('photo', row.device_id, () => inPlace(row.place, () => w.read(ask)));
      outcome = { status: 'done', analysis, error: null };
    } catch (error) {
      outcome = { status: 'failed', analysis: null, error: w.failure(error) };
    }
    const kept = await finish(row, attempt, outcome).catch(() => false);
    if (kept && outcome.status === 'failed' && row.counted) await w.onFail(row.device_id).catch(() => {});
  })();
}

/** Keep the outcome of one try; false if a later try has the snap now. The photo goes either way. */
async function finish(row: Row, attempt: number, outcome: Pick<Row, 'status' | 'analysis' | 'error'>): Promise<boolean> {
  if (!hasDatabase()) {
    const now = memory.get(keyOf(row.device_id, row.id));
    if (!now || now.attempts !== attempt || now.status !== 'working') return false;
    Object.assign(now, outcome, { image: null });
    return true;
  }
  const rows = await query(
    `update snaps set status = $4, analysis = $5, error = $6, image = null, finished_at = now()
      where device_id = $1 and id = $2 and attempts = $3 and status = 'working' returning 1`,
    [row.device_id, row.id, attempt, outcome.status, outcome.analysis ? JSON.stringify(outcome.analysis) : null, outcome.error],
  );
  return rows.length > 0;
}

/**
 * A device's snaps, for the app to log. Any still being read by an instance
 * that has gone quiet (a deploy) is started again here, or failed after too
 * many tries.
 */
export async function snapsFor(deviceId: string): Promise<Snap[]> {
  const rows = hasDatabase()
    ? (await migrate(), await query<Row>(`select * from snaps where device_id = $1 order by created_at`, [deviceId]))
    : [...memory.values()].filter((row) => row.device_id === deviceId);
  for (const row of rows) {
    if (row.status !== 'working' || Date.now() - new Date(row.claimed_at).getTime() < DEAD_MS) continue;
    await rescue(row);
  }
  return rows.map((row) => ({
    id: row.id,
    date: row.ask.date,
    time: row.ask.time,
    ...(row.ask.slot ? { slot: row.ask.slot } : {}),
    status: row.status,
    ...(row.analysis ? { analysis: row.analysis } : {}),
    ...(row.error ? { error: row.error } : {}),
  }));
}

/** Take over a read nobody is making: again, or failed if it has had its tries. */
async function rescue(row: Row): Promise<void> {
  const out = row.attempts >= MAX_ATTEMPTS || !row.image;
  const attempt = row.attempts + 1;
  if (!hasDatabase()) {
    if (out) {
      Object.assign(row, { status: 'failed', error: theWorker().failure(new Error('cut off')), image: null });
      if (row.counted) await theWorker().onFail(row.device_id).catch(() => {});
      return;
    }
    Object.assign(row, { attempts: attempt, claimed_at: new Date() });
    read(row, attempt);
    return;
  }
  if (out) {
    const failed = await query(
      `update snaps set status = 'failed', error = $3, image = null, finished_at = now()
        where device_id = $1 and id = $2 and attempts = $4 and status = 'working' returning 1`,
      [row.device_id, row.id, theWorker().failure(new Error('cut off')), row.attempts],
    );
    Object.assign(row, { status: 'failed', error: theWorker().failure(new Error('cut off')) });
    if (failed.length && row.counted) await theWorker().onFail(row.device_id).catch(() => {});
    return;
  }
  // Claimed only if nobody else has since: two apps asking at once start one read.
  const claimed = await query(
    `update snaps set attempts = $3, claimed_at = now()
      where device_id = $1 and id = $2 and attempts = $4 and status = 'working' returning 1`,
    [row.device_id, row.id, attempt, row.attempts],
  );
  if (!claimed.length) return;
  row.attempts = attempt;
  read(row, attempt);
}

/** Collected: the app has them now, so the server has no reason to. */
export async function forgetSnaps(deviceId: string, ids: string[]): Promise<void> {
  const clean = ids.filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id)).slice(0, 50);
  if (!clean.length) return;
  if (!hasDatabase()) {
    for (const id of clean) {
      const row = memory.get(keyOf(deviceId, id));
      if (row && row.status !== 'working') memory.delete(keyOf(deviceId, id));
    }
    return;
  }
  await migrate();
  await query(`delete from snaps where device_id = $1 and id = any($2) and status <> 'working'`, [deviceId, clean]);
}

/** A read nobody has come back for in this long has been abandoned: failed, and its photo gone. */
export const ABANDONED_MS = 30 * 60_000;

/**
 * Hourly, on every instance: a read abandoned (its app never asked again, so
 * nothing started it over) is failed and its photo deleted, and anything over
 * a week old, collected or not, is deleted. Photos do not wait on the server
 * for somebody who is not coming back.
 */
export async function sweepSnaps(now: number = Date.now()): Promise<void> {
  const w = theWorker();
  if (!hasDatabase()) {
    for (const [key, row] of memory) {
      if (now - row.created_at.getTime() > KEEP_DAYS * 86_400_000) memory.delete(key);
      else if (row.status === 'working' && now - row.claimed_at.getTime() > ABANDONED_MS) {
        Object.assign(row, { status: 'failed', error: w.failure(new Error('abandoned')), image: null });
        if (row.counted) await w.onFail(row.device_id).catch(() => {});
      }
    }
    return;
  }
  await migrate();
  const abandoned = await query<{ device_id: string; counted: boolean }>(
    `update snaps set status = 'failed', error = $1, image = null, finished_at = now()
      where status = 'working' and claimed_at < now() - make_interval(secs => $2)
      returning device_id, counted`,
    [w.failure(new Error('abandoned')), ABANDONED_MS / 1000],
  );
  for (const row of abandoned) if (row.counted) await w.onFail(row.device_id).catch(() => {});
  await query(`delete from snaps where created_at < now() - make_interval(days => $1)`, [KEEP_DAYS]);
}
