/**
 * Weekly plans, made in the background.
 *
 * A week of meals can take the nutritionist a few minutes. Held open as one
 * request, that was longer than the app waited: it gave up, the plan was
 * finished and paid for anyway, and nobody ever saw it. So the request now
 * starts a job and answers at once with its id, and the app asks after the
 * job until it is done — however long that takes, and even after the app was
 * closed and opened again.
 *
 * Kept in the database, so any instance of the server can answer for a job
 * another started, and a restart mid-plan is noticed rather than waited on
 * for ever. Without a database (local development) they live in memory.
 */
import { randomBytes } from 'node:crypto';
import { hasDatabase, migrate, query } from './db';
import type { WeekPlan } from './claude';

export type Job = { status: 'working' } | { status: 'done'; plan: WeekPlan } | { status: 'failed'; error: string };

/** Longer than any plan takes; a job still "working" after this was cut off by a restart. */
export const STALE_MS = 15 * 60_000;
const KEEP_MS = 24 * 60 * 60_000;

type Row = {
  device_id: string | null;
  owner: string | null;
  status: 'working' | 'done' | 'failed';
  plan: WeekPlan | null;
  error: string | null;
  created_at: Date;
};

const memory = new Map<string, Row & { id: string }>();

/**
 * Start a plan. `make` runs in the background; `onFail` is told when it did
 * not produce one (to give the question back), including when the server
 * restarted part-way and the job is found stale later.
 */
export async function startJob(
  who: { deviceId: string | null; owner: string | null },
  make: () => Promise<WeekPlan>,
  onFail: (deviceId: string | null) => Promise<void>,
  failure: (error: unknown) => string,
): Promise<string> {
  const id = randomBytes(18).toString('base64url');
  if (hasDatabase()) {
    await migrate();
    await query(`delete from weekplan_jobs where created_at < now() - interval '1 day'`).catch(() => {});
    await query('insert into weekplan_jobs (id, device_id, owner) values ($1, $2, $3)', [id, who.deviceId, who.owner]);
  } else {
    for (const [key, row] of memory) if (Date.now() - row.created_at.getTime() > KEEP_MS) memory.delete(key);
    memory.set(id, { id, device_id: who.deviceId, owner: who.owner, status: 'working', plan: null, error: null, created_at: new Date() });
  }

  void (async () => {
    try {
      const plan = await make();
      await finish(id, { status: 'done', plan });
    } catch (error) {
      await finish(id, { status: 'failed', error: failure(error) });
      await onFail(who.deviceId).catch(() => {});
    }
  })();
  return id;
}

async function finish(id: string, job: Exclude<Job, { status: 'working' }>): Promise<void> {
  if (!hasDatabase()) {
    const row = memory.get(id);
    if (row) Object.assign(row, { status: job.status, plan: job.status === 'done' ? job.plan : null, error: job.status === 'failed' ? job.error : null });
    return;
  }
  await query(`update weekplan_jobs set status = $2, plan = $3, error = $4, finished_at = now() where id = $1 and status = 'working'`, [
    id,
    job.status,
    job.status === 'done' ? JSON.stringify(job.plan) : null,
    job.status === 'failed' ? job.error : null,
  ]).catch((error: unknown) => console.error('[squish] could not save a weekly plan:', error instanceof Error ? error.message : error));
}

/**
 * How a job is getting on, for whoever started it — or null for no such job
 * (or somebody else's). A job still working long after any plan would have
 * finished was cut off by a restart: it is failed now, and `onStale` gives
 * the question back, once.
 */
export async function readJob(id: string, owner: string | null, onStale: (deviceId: string | null) => Promise<void>, staleMessage: string): Promise<Job | null> {
  let row: Row | undefined;
  if (hasDatabase()) {
    await migrate();
    row = (await query<Row>('select device_id, owner, status, plan, error, created_at from weekplan_jobs where id = $1', [id]))[0];
  } else {
    row = memory.get(id);
  }
  if (!row) return null;
  // A job started by a known browser is only that browser's (or its account's) to read.
  if (row.owner && row.owner !== owner) return null;

  if (row.status === 'working' && Date.now() - row.created_at.getTime() > STALE_MS) {
    if (hasDatabase()) {
      const claimed = await query(`update weekplan_jobs set status = 'failed', error = $2, finished_at = now() where id = $1 and status = 'working' returning 1`, [id, staleMessage]);
      if (claimed.length) await onStale(row.device_id).catch(() => {});
    } else {
      Object.assign(row, { status: 'failed', error: staleMessage });
      await onStale(row.device_id).catch(() => {});
    }
    return { status: 'failed', error: staleMessage };
  }
  if (row.status === 'done' && row.plan) return { status: 'done', plan: row.plan };
  if (row.status === 'failed') return { status: 'failed', error: row.error ?? staleMessage };
  return { status: 'working' };
}
