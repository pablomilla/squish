/**
 * Weekly plans, made in the background.
 *
 * A week of meals can take the nutritionist a few minutes. Held open as one
 * request, that was longer than the app waited: it gave up, the plan was
 * finished and paid for anyway, and nobody ever saw it. So the request starts
 * a job and answers at once with its id, and the app asks after the job until
 * it is done — however long that takes, and even after the app was closed
 * and opened again.
 *
 * A job also outlives the server making it. Every deploy restarts the server,
 * and a plan being made at that moment used to vanish with it: still
 * "working" for a quarter of an hour, its question spent, given back only if
 * the app happened to ask at the right time. Now the request is kept with the
 * job, the instance making it vouches for it every few seconds, and any
 * instance that finds a job nobody has vouched for in a minute takes it over
 * and makes the plan again. After a few tries it is failed instead, and its
 * question given back there and then — nobody has to be watching.
 *
 * Without a database (local development) jobs live in memory and die with
 * the process, which is fine for a laptop.
 */
import { randomBytes } from 'node:crypto';
import { hasDatabase, migrate, query } from './db';
import type { WeekPlan } from './claude';
import type { WeekPlanRequest } from './weekplan';

export type Job = { status: 'working' } | { status: 'done'; plan: WeekPlan } | { status: 'failed'; error: string };

/** What a job does and what happens after. Set once, by the server, before any job starts. */
export interface Worker {
  /** Make the plan. Abandon it when the signal says so: somebody else has the job now. */
  make: (ask: WeekPlanRequest, signal: AbortSignal) => Promise<WeekPlan>;
  /** A plan was made: count it. Called once per job, whichever instance finished it. */
  onDone: (deviceId: string | null) => Promise<void>;
  /** No plan: give the question back. Called once per job. */
  onFail: (deviceId: string | null) => Promise<void>;
  /** What to tell the person about an error. */
  failure: (error: unknown) => string;
  /** What to tell them when it was cut off too often to go on. */
  cutOff: string;
}

/** How often the instance making a plan says it still is. */
export const HEARTBEAT_MS = 10_000;
/** Unheard from for this long, a job's instance is gone. */
export const DEAD_MS = 60_000;
/** How often every instance looks for such jobs. */
const SWEEP_MS = 15_000;
/** Tries in all, the first included: enough for a deploy or two, not a loop. */
export const MAX_ATTEMPTS = 3;
/** However it is going, a plan still not made after this is given up on. */
export const STALE_MS = 20 * 60_000;
const KEEP_MS = 24 * 60 * 60_000;

type Row = {
  device_id: string | null;
  owner: string | null;
  status: 'working' | 'done' | 'failed';
  plan: WeekPlan | null;
  error: string | null;
  created_at: Date;
  heartbeat_at: Date;
};

const memory = new Map<string, Row & { id: string }>();
/** The runs this instance is making, by job id: for handing them over on shutdown. */
const running = new Map<string, { run: string; stop: AbortController }>();

let worker: Worker | null = null;
export function setWorker(next: Worker): void {
  worker = next;
}
const theWorker = (): Worker => {
  if (!worker) throw new Error('weekly plan jobs started before setWorker');
  return worker;
};

const newId = (): string => randomBytes(18).toString('base64url');

/** Start a plan: answered at once with the job's id, made in the background. */
export async function startJob(who: { deviceId: string | null; owner: string | null }, ask: WeekPlanRequest): Promise<string> {
  const id = newId();
  if (!hasDatabase()) {
    for (const [key, row] of memory) if (Date.now() - row.created_at.getTime() > KEEP_MS) memory.delete(key);
    memory.set(id, { id, device_id: who.deviceId, owner: who.owner, status: 'working', plan: null, error: null, created_at: new Date(), heartbeat_at: new Date() });
    runInMemory(id, who.deviceId, ask);
    return id;
  }
  await migrate();
  await query(`delete from weekplan_jobs where created_at < now() - interval '1 day'`).catch(() => {});
  const run = newId();
  await query('insert into weekplan_jobs (id, device_id, owner, ask, run) values ($1, $2, $3, $4, $5)', [id, who.deviceId, who.owner, JSON.stringify(ask), run]);
  runJob(id, run, who.deviceId, ask);
  return id;
}

function runInMemory(id: string, deviceId: string | null, ask: WeekPlanRequest): void {
  const w = theWorker();
  void (async () => {
    const row = memory.get(id)!;
    try {
      const plan = await w.make(ask, new AbortController().signal);
      Object.assign(row, { status: 'done', plan });
      await w.onDone(deviceId).catch(() => {});
    } catch (error) {
      Object.assign(row, { status: 'failed', error: w.failure(error) });
      await w.onFail(deviceId).catch(() => {});
    }
  })();
}

/**
 * Make one job's plan, as run `run`. Only the run that still holds the job
 * may finish it, so two instances that both think they have it can never
 * both count it, or both give its question back.
 */
function runJob(id: string, run: string, deviceId: string | null, ask: WeekPlanRequest): void {
  const w = theWorker();
  const stop = new AbortController();
  running.set(id, { run, stop });

  const beat = setInterval(() => {
    void query(`update weekplan_jobs set heartbeat_at = now() where id = $1 and run = $2 and status = 'working' returning 1`, [id, run])
      .then((rows) => {
        // Taken over, or failed by a sweep: stop spending on a plan nobody will see.
        if (!rows.length) stop.abort();
      })
      .catch(() => {
        /* the database had a bad moment; the next beat will tell */
      });
  }, HEARTBEAT_MS);
  beat.unref();

  void (async () => {
    let outcome: { status: 'done'; plan: WeekPlan } | { status: 'failed'; error: string };
    try {
      outcome = { status: 'done', plan: await w.make(ask, stop.signal) };
    } catch (error) {
      // Stopped on purpose: the job is somebody else's now (or ours to hand over).
      if (stop.signal.aborted) return;
      outcome = { status: 'failed', error: w.failure(error) };
    } finally {
      clearInterval(beat);
      if (running.get(id)?.run === run) running.delete(id);
    }
    const kept = await query(
      `update weekplan_jobs set status = $3, plan = $4, error = $5, finished_at = now()
        where id = $1 and run = $2 and status = 'working' returning 1`,
      [id, run, outcome.status, outcome.status === 'done' ? JSON.stringify(outcome.plan) : null, outcome.status === 'failed' ? outcome.error : null],
    ).catch((error: unknown) => {
      console.error('[squish] could not save a weekly plan:', error instanceof Error ? error.message : error);
      return [];
    });
    if (!kept.length) return;
    if (outcome.status === 'done') await w.onDone(deviceId).catch(() => {});
    else await w.onFail(deviceId).catch(() => {});
  })();
}

/**
 * Find the jobs whose instance has gone quiet, and take each one over — or,
 * after enough tries, or once far too long has passed, fail it and give its
 * question back. Safe to run on every instance at once: a job is claimed by
 * one of them, by a row lock, and its run id changes as it is.
 */
export async function sweepJobs(): Promise<void> {
  if (!hasDatabase()) return;
  await migrate();
  const w = theWorker();

  // Too long, however lively: a stream that has hung. Its instance sees the
  // status change at its next beat and stops.
  const expired = await query<{ device_id: string | null }>(
    `update weekplan_jobs set status = 'failed', error = $1, finished_at = now()
      where status = 'working' and created_at < now() - make_interval(secs => $2)
      returning device_id`,
    [w.cutOff, STALE_MS / 1000],
  );
  for (const row of expired) await w.onFail(row.device_id).catch(() => {});

  for (;;) {
    const run = newId();
    const claimed = (
      await query<{ id: string; device_id: string | null; ask: WeekPlanRequest | null; attempts: number }>(
        `update weekplan_jobs set run = $1, heartbeat_at = now(), attempts = attempts + 1
          where id = (select id from weekplan_jobs
                       where status = 'working' and heartbeat_at < now() - make_interval(secs => $2)
                       order by created_at limit 1 for update skip locked)
          returning id, device_id, ask, attempts`,
        [run, DEAD_MS / 1000],
      )
    )[0];
    if (!claimed) return;

    if (!claimed.ask || claimed.attempts > MAX_ATTEMPTS) {
      const failed = await query(
        // The claim counted a try that is not being made.
        `update weekplan_jobs set status = 'failed', error = $3, finished_at = now(), attempts = attempts - 1
          where id = $1 and run = $2 and status = 'working' returning 1`,
        [claimed.id, run, w.cutOff],
      );
      if (failed.length) await w.onFail(claimed.device_id).catch(() => {});
      console.warn(`[squish] weekplan ${claimed.id} cut off ${claimed.attempts - 1} times — failed, question given back`);
      continue;
    }
    console.info(`[squish] weekplan ${claimed.id} lost its instance — making it again (try ${claimed.attempts} of ${MAX_ATTEMPTS})`);
    runJob(claimed.id, run, claimed.device_id, claimed.ask);
  }
}

let sweeping: NodeJS.Timeout | null = null;

/** Look for abandoned jobs now and every little while, for as long as the server runs. */
export function startSweeping(): void {
  if (!hasDatabase() || sweeping) return;
  const sweep = () =>
    void sweepJobs().catch((error: unknown) => console.warn('[squish] weekplan sweep:', error instanceof Error ? error.message : error));
  sweep();
  sweeping = setInterval(sweep, SWEEP_MS);
  sweeping.unref();
}

/**
 * Shutting down (a deploy): stop making plans here and mark them as nobody's,
 * so the next instance takes them over at its next sweep rather than waiting
 * a minute to be sure.
 */
export async function handOver(): Promise<number> {
  if (sweeping) clearInterval(sweeping);
  sweeping = null;
  const mine = [...running.entries()];
  for (const [, { stop }] of mine) stop.abort();
  running.clear();
  if (!mine.length || !hasDatabase()) return mine.length;
  for (const [id, { run }] of mine) {
    await query(`update weekplan_jobs set heartbeat_at = 'epoch' where id = $1 and run = $2 and status = 'working'`, [id, run]).catch(() => {});
  }
  return mine.length;
}

/** How a job is getting on, for whoever started it — or null for no such job (or somebody else's). */
export async function readJob(id: string, owner: string | null): Promise<Job | null> {
  let row: Row | undefined;
  const read = async () =>
    (await query<Row>('select device_id, owner, status, plan, error, created_at, heartbeat_at from weekplan_jobs where id = $1', [id]))[0];
  if (hasDatabase()) {
    await migrate();
    row = await read();
    // Abandoned and not yet noticed: notice now rather than at the next sweep.
    if (row?.status === 'working' && Date.now() - row.heartbeat_at.getTime() > DEAD_MS) {
      await sweepJobs();
      row = await read();
    }
  } else {
    row = memory.get(id);
  }
  if (!row) return null;
  // A job started by a known browser is only that browser's (or its account's) to read.
  if (row.owner && row.owner !== owner) return null;
  if (row.status === 'done' && row.plan) return { status: 'done', plan: row.plan };
  if (row.status === 'failed') return { status: 'failed', error: row.error ?? theWorker().cutOff };
  return { status: 'working' };
}

export interface PlanRecord {
  at: string;
  /** Whose, when the account is known. Never what was planned: that is their diary. */
  email: string | null;
  days: number | null;
  status: Job['status'];
  /** Tries it took: more than one means a server stopped part-way. */
  attempts: number;
  /** How long it took, or has taken so far. */
  seconds: number;
  error: string | null;
}

/** The latest plans asked for, for the dashboard: how each went, and why not. */
export async function recentPlans(limit = 20): Promise<PlanRecord[]> {
  if (!hasDatabase()) return [];
  await migrate();
  const rows = await query<{ created_at: Date; email: string | null; days: string | null; status: Job['status']; attempts: number; seconds: string; error: string | null }>(
    `select j.created_at, a.email, j.ask->>'days' as days, j.status, j.attempts, j.error,
            extract(epoch from coalesce(j.finished_at, now()) - j.created_at)::text as seconds
       from weekplan_jobs j
       left join accounts a on a.id = j.owner
      order by j.created_at desc
      limit $1`,
    [limit],
  );
  return rows.map((row) => ({
    at: row.created_at.toISOString(),
    email: row.email,
    days: row.days === null ? null : Number(row.days),
    status: row.status,
    attempts: row.attempts,
    seconds: Math.round(Number(row.seconds)),
    error: row.error,
  }));
}
