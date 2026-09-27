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
import { billedAs, modelName } from './billing';
import { audienceOf, servedAs } from './routing';
import type { WeekPlan } from './claude';
import type { WeekPlanRequest } from './weekplan';
import { currentPlace, inPlace, placeFrom, type Place } from './region';

export type Job = { status: 'working' } | { status: 'done'; plan: WeekPlan } | { status: 'failed'; error: string };
/** A job as read by whoever asked for it: a plan read for the first time is theirs to count. */
export type ReadJob = Job & { firstTime?: boolean };

/** What a job does and what happens after. Set once, by the server, before any job starts. */
export interface Worker {
  /** Make the plan. Abandon it when the signal says so: somebody else has the job now. */
  make: (ask: WeekPlanRequest, signal: AbortSignal) => Promise<WeekPlan>;
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
/**
 * However it is going, a plan still not made after this is given up on. Room
 * for a slow model cut off at its ten minutes (server/routing.ts) and its
 * backup, or for a deploy restarting a plan part-way.
 */
export const STALE_MS = 35 * 60_000;
const KEEP_MS = 24 * 60 * 60_000;

type Row = {
  id?: string;
  device_id: string | null;
  owner: string | null;
  status: 'working' | 'done' | 'failed';
  plan: WeekPlan | null;
  error: string | null;
  created_at: Date;
  heartbeat_at: Date;
  delivered_at: Date | null;
  counted: boolean;
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

/**
 * What a job's calls cost, added to the job as each is priced — by whichever
 * run makes them, so a try cut off by a restart still counts — along with the
 * model that answered last, which for a plan that was made is the one that
 * made it. `settled` waits for the writes still on their way, so a finished
 * job's cost is complete before it is added to the running totals.
 */
function costKeeper(id: string): { tally: (usd: number | null, model: string) => void; settled: () => Promise<unknown> } {
  const pending = new Set<Promise<unknown>>();
  const tally = (usd: number | null, model: string) => {
    const cost = usd && Number.isFinite(usd) && usd > 0 ? usd.toFixed(6) : '0';
    const write = query(
      `update weekplan_jobs
          set model = $2::text,
              costs = coalesce(costs, '{}'::jsonb) || jsonb_build_object($2::text, coalesce((costs->>$2::text)::numeric, 0) + $3::numeric)
        where id = $1`,
      [id, modelName(model), cost],
    ).catch(() => {
      /* a gap in a report, never a failed plan */
    });
    pending.add(write);
    void write.finally(() => pending.delete(write));
  };
  return { tally, settled: () => Promise.allSettled([...pending]) };
}

/**
 * A finished job's cost, added to the day's totals by model, plan length and
 * outcome: kept after the job itself is gone. Called once per job, by
 * whatever finished it.
 */
async function keepPlanCost(id: string): Promise<void> {
  await query(
    `insert into weekplan_costs (day, model, days, outcome, plans, cost_usd)
     select current_date, coalesce(j.model, 'none'), coalesce((j.ask->>'days')::numeric, 0)::int,
            case when j.status = 'done' then 'made' else 'failed' end, 1,
            coalesce((select sum(value::numeric) from jsonb_each_text(j.costs)), 0)
       from weekplan_jobs j
      where j.id = $1 and j.status in ('done', 'failed')
     on conflict (day, model, days, outcome)
       do update set plans = weekplan_costs.plans + 1, cost_usd = weekplan_costs.cost_usd + excluded.cost_usd`,
    [id],
  ).catch((error: unknown) => console.warn('[squish] could not keep a weekly plan cost:', error instanceof Error ? error.message : error));
}

/** Start a plan: answered at once with the job's id, made in the background. */
/**
 * Start a plan: answered at once with the job's id, made in the background.
 * Where the person is comes from the request that asked (`currentPlace`),
 * and is kept with the job so every attempt at it is made for them.
 */
export async function startJob(
  who: { deviceId: string | null; owner: string | null },
  ask: WeekPlanRequest,
  place: Place = currentPlace(),
): Promise<string> {
  const id = newId();
  if (!hasDatabase()) {
    for (const [key, row] of memory) if (Date.now() - row.created_at.getTime() > KEEP_MS) memory.delete(key);
    memory.set(id, {
      id, device_id: who.deviceId, owner: who.owner, status: 'working', plan: null, error: null,
      created_at: new Date(), heartbeat_at: new Date(), delivered_at: null, counted: false,
    });
    runInMemory(id, who.deviceId, ask, place);
    return id;
  }
  await migrate();
  await query(`delete from weekplan_jobs where created_at < now() - interval '1 day'`).catch(() => {});
  const run = newId();
  await query('insert into weekplan_jobs (id, device_id, owner, ask, run, place) values ($1, $2, $3, $4, $5, $6)', [
    id, who.deviceId, who.owner, JSON.stringify(ask), run, JSON.stringify(place),
  ]);
  runJob(id, run, who.deviceId, ask, place);
  return id;
}

function runInMemory(id: string, deviceId: string | null, ask: WeekPlanRequest, place: Place): void {
  const w = theWorker();
  void (async () => {
    const row = memory.get(id)!;
    try {
      const plan = await billedAs('weekplan', deviceId, () => inPlace(place, () => w.make(ask, new AbortController().signal)));
      Object.assign(row, { status: 'done', plan });
    } catch (error) {
      Object.assign(row, { status: 'failed', error: w.failure(error) });
      await w.onFail(deviceId).catch(() => {});
    }
  })();
}

/**
 * Make one job's plan, as run `run`. Only the run that still holds the job
 * may finish it, so two instances that both think they have it can never
 * both finish it, or both give its question back.
 */
function runJob(id: string, run: string, deviceId: string | null, ask: WeekPlanRequest, place: Place): void {
  const w = theWorker();
  const stop = new AbortController();
  const costs = costKeeper(id);
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
      // Made where they are, whichever instance makes it and however long after they asked.
      // And paid for as a weekly plan, whether it started in the request or was picked up after a restart.
      // On the route of whoever asked — an admin's own, or everybody's — even when picked up after a restart.
      const audience = await audienceOf(deviceId).catch(() => 'everyone' as const);
      outcome = {
        status: 'done',
        plan: await servedAs(audience, () => billedAs('weekplan', deviceId, () => inPlace(place, () => w.make(ask, stop.signal)), costs.tally)),
      };
    } catch (error) {
      // Stopped on purpose: the job is somebody else's now (or ours to hand over).
      if (stop.signal.aborted) return;
      outcome = { status: 'failed', error: w.failure(error) };
    } finally {
      clearInterval(beat);
      if (running.get(id)?.run === run) running.delete(id);
    }
    await costs.settled();
    const kept = await query(
      `update weekplan_jobs set status = $3, plan = $4, error = $5, finished_at = now()
        where id = $1 and run = $2 and status = 'working' returning 1`,
      [id, run, outcome.status, outcome.status === 'done' ? JSON.stringify(outcome.plan) : null, outcome.status === 'failed' ? outcome.error : null],
    ).catch((error: unknown) => {
      console.error('[squish] could not save a weekly plan:', error instanceof Error ? error.message : error);
      return [];
    });
    if (kept.length) await keepPlanCost(id);
    if (kept.length && outcome.status === 'failed') await w.onFail(deviceId).catch(() => {});
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
  const expired = await query<{ id: string; device_id: string | null }>(
    `update weekplan_jobs set status = 'failed', error = $1, finished_at = now()
      where status = 'working' and created_at < now() - make_interval(secs => $2)
      returning id, device_id`,
    [w.cutOff, STALE_MS / 1000],
  );
  for (const row of expired) {
    await keepPlanCost(row.id);
    await w.onFail(row.device_id).catch(() => {});
  }

  for (;;) {
    const run = newId();
    const claimed = (
      await query<{ id: string; device_id: string | null; ask: WeekPlanRequest | null; attempts: number; place: Partial<Place> | null }>(
        `update weekplan_jobs set run = $1, heartbeat_at = now(), attempts = attempts + 1
          where id = (select id from weekplan_jobs
                       where status = 'working' and heartbeat_at < now() - make_interval(secs => $2)
                       order by created_at limit 1 for update skip locked)
          returning id, device_id, ask, attempts, place`,
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
      if (failed.length) {
        await keepPlanCost(claimed.id);
        await w.onFail(claimed.device_id).catch(() => {});
      }
      console.warn(`[squish] weekplan ${claimed.id} cut off ${claimed.attempts - 1} times — failed, question given back`);
      continue;
    }
    console.info(`[squish] weekplan ${claimed.id} lost its instance — making it again (try ${claimed.attempts} of ${MAX_ATTEMPTS})`);
    // Checked as a request's headers are: only known values, defaults for anything else (and for jobs from before places were kept).
    const place = placeFrom(claimed.place?.region, claimed.place?.energy, claimed.place?.language, claimed.place?.diet);
    runJob(claimed.id, run, claimed.device_id, claimed.ask, place);
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

/**
 * How a job is getting on, for whoever started it — or null for no such job
 * (or somebody else's). The first time a made plan is read it is delivered,
 * and `firstTime` says so: that is when it counts against the month.
 */
export async function readJob(id: string, owner: string | null): Promise<ReadJob | null> {
  let row: Row | undefined;
  const read = async () =>
    (
      await query<Row>(
        'select device_id, owner, status, plan, error, created_at, heartbeat_at, delivered_at, counted from weekplan_jobs where id = $1',
        [id],
      )
    )[0];
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
  if (row.status === 'failed') return { status: 'failed', error: row.error ?? theWorker().cutOff };
  if (row.status !== 'done' || !row.plan) return { status: 'working' };

  let firstTime = false;
  if (hasDatabase()) {
    // Delivered and counted in one step, so two reads at once count it once.
    const marked = await query<{ was_counted: boolean }>(
      `update weekplan_jobs j set delivered_at = coalesce(j.delivered_at, now()), counted = true
         from (select id, counted from weekplan_jobs where id = $1 for update) old
        where j.id = old.id
        returning old.counted as was_counted`,
      [id],
    );
    firstTime = marked.length > 0 && !marked[0].was_counted;
  } else {
    firstTime = !row.counted;
    Object.assign(row, { counted: true, delivered_at: row.delivered_at ?? new Date() });
  }
  return { status: 'done', plan: row.plan, firstTime };
}

/**
 * A plan this person asked for in the last day and has not seen — made
 * while the app was closed, or still being made. The newest, if any.
 */
export async function waitingJob(owner: string): Promise<string | null> {
  const rows = hasDatabase()
    ? await query<{ id: string }>(
        `select id from weekplan_jobs
          where owner = $1 and created_at > now() - interval '1 day'
            and (status = 'working' or (status = 'done' and delivered_at is null))
          order by created_at desc limit 1`,
        [owner],
      )
    : [...memory.values()]
        .filter((row) => row.owner === owner && (row.status === 'working' || (row.status === 'done' && !row.delivered_at)))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  return rows[0]?.id ?? null;
}

/**
 * This person's latest made plan from the last day — delivered or not — so
 * the app can offer it again if it never reached them: an app still running
 * an old version, a phone that died as it arrived. The app decides whether it
 * is one they already added or threw away.
 */
export async function latestMadePlan(owner: string): Promise<{ job: string; plan: WeekPlan } | null> {
  if (!hasDatabase()) {
    const row = [...memory.values()]
      .filter((r) => r.owner === owner && r.status === 'done' && r.plan)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
    return row ? { job: row.id, plan: row.plan! } : null;
  }
  const rows = await query<{ id: string; plan: WeekPlan }>(
    `select id, plan from weekplan_jobs
      where owner = $1 and status = 'done' and plan is not null and created_at > now() - interval '1 day'
      order by created_at desc limit 1`,
    [owner],
  );
  return rows[0] ? { job: rows[0].id, plan: rows[0].plan } : null;
}

/**
 * Plans this person has on the way this month that are not counted yet —
 * being made, or made and not yet seen. The monthly cap counts them, so
 * starting several at once is no way round it.
 */
export async function plansOnTheWay(owner: string): Promise<number> {
  if (!hasDatabase()) return 0;
  const rows = await query<{ n: string }>(
    `select count(*)::text as n from weekplan_jobs
      where owner = $1 and created_at >= date_trunc('month', now()) and not counted
        and (status = 'working' or status = 'done')`,
    [owner],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface PlanRecord {
  at: string;
  /** Whose, when the account is known. Never what was planned: that is their diary. */
  email: string | null;
  days: number | null;
  status: Job['status'];
  /** Made, and has reached the person (only then is it counted). */
  seen: boolean;
  /** Tries it took: more than one means a server stopped part-way. */
  attempts: number;
  /** How long it took, or has taken so far. */
  seconds: number;
  error: string | null;
  /** The model that answered last: for a plan that was made, the one that made it. */
  model: string | null;
  /** What it cost in all, in dollars; null for plans from before costs were kept. */
  costUsd: number | null;
  /** Every model asked and what each came to, the one that made it last. */
  costs: { model: string; usd: number }[];
}

/** The latest plans asked for, for the dashboard: how each went, and why not, what made it and what it cost. */
export async function recentPlans(limit = 50): Promise<PlanRecord[]> {
  if (!hasDatabase()) return [];
  await migrate();
  const rows = await query<{
    created_at: Date; email: string | null; days: string | null; status: Job['status']; seen: boolean; attempts: number;
    seconds: string; error: string | null; model: string | null; costs: Record<string, number | string> | null;
  }>(
    `select j.created_at, a.email, j.ask->>'days' as days, j.status, j.delivered_at is not null as seen, j.attempts, j.error,
            extract(epoch from coalesce(j.finished_at, now()) - j.created_at)::text as seconds, j.model, j.costs
       from weekplan_jobs j
       left join accounts a on a.id = j.owner
      order by j.created_at desc
      limit $1`,
    [limit],
  );
  return rows.map((row) => {
    const costs = Object.entries(row.costs ?? {})
      .map(([model, usd]) => ({ model, usd: Number(usd) }))
      .sort((a, b) => Number(a.model === row.model) - Number(b.model === row.model));
    return {
      at: row.created_at.toISOString(),
      email: row.email,
      days: row.days === null ? null : Number(row.days),
      status: row.status,
      seen: row.seen,
      attempts: row.attempts,
      seconds: Math.round(Number(row.seconds)),
      error: row.error,
      model: row.model,
      costUsd: row.costs === null ? null : costs.reduce((sum, c) => sum + c.usd, 0),
      costs,
    };
  });
}

export interface PlanCost {
  model: string;
  days: number;
  outcome: 'made' | 'failed';
  plans: number;
  usd: number;
}

/** Plans finished over the last `days` days, by the model that made them, their length and how they went. */
export async function planCosts(days = 30): Promise<PlanCost[]> {
  if (!hasDatabase()) return [];
  await migrate();
  const rows = await query<{ model: string; days: number; outcome: 'made' | 'failed'; plans: string; usd: string }>(
    `select model, days, outcome, sum(plans)::text as plans, sum(cost_usd)::text as usd
       from weekplan_costs
      where day > current_date - $1::int
      group by model, days, outcome
      order by outcome desc, days, model`,
    [days],
  );
  return rows.map((row) => ({ model: row.model, days: row.days, outcome: row.outcome, plans: Number(row.plans), usd: Number(row.usd) }));
}
