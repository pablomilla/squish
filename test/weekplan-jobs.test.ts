import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { refund, spend } from '../server/identity';
import { DEAD_MS, MAX_ATTEMPTS, STALE_MS, handOver, planCosts, plansOnTheWay, readJob, recentPlans, setWorker, startJob, sweepJobs, waitingJob } from '../server/weekplanJobs';
import { bill } from '../server/billing';
import { withModels } from '../server/routing';
import type { WeekPlan } from '../server/claude';
import type { WeekPlanRequest } from '../server/weekplan';
import { currentPlace, inPlace } from '../server/region';

/**
 * A weekly plan is made in the background and asked after, so a slow one is
 * never lost to a timeout; one whose server stops part-way (a deploy) is made
 * again by another; one made counts when it is first seen, and waits to be
 * seen if nobody was looking; and one that fails, however, gives its
 * question back — once, and without anybody having to ask after it.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

const WEEK: WeekPlan = { summary: 'A calm week', days: [{ date: '2026-09-28', meals: [], calories: 1800, underFloor: false }] };
const ASK = { startDate: '2026-09-28', days: 3 } as WeekPlanRequest;

/**
 * The worker the tests drive: each plan waits for the test to say how it
 * ends (keyed by the ask's preferences), and what was given back is written
 * down, by device.
 */
const endings = new Map<string, { resolve: (plan: WeekPlan) => void; reject: (error: Error) => void; signal: AbortSignal }[]>();
const made: string[] = [];
/** Where each plan was made, by the ask's key: one entry per attempt. */
const madeIn = new Map<string, string[]>();
const givenBack: (string | null)[] = [];
setWorker({
  make: (ask, signal) =>
    new Promise<WeekPlan>((resolve, reject) => {
      const key = ask.preferences;
      made.push(key);
      const place = currentPlace();
      madeIn.set(key, [...(madeIn.get(key) ?? []), `${place.region}/${place.energy}/${place.language}`]);
      endings.set(key, [...(endings.get(key) ?? []), { resolve, reject, signal }]);
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      // A plan whose first model failed after being paid for, and whose backup made it.
      if (key.startsWith('billed:')) {
        bill(0.0125, 'gemini-3.8-flash');
        bill(0.2, 'claude-sonnet-5-20260901');
      }
      // A plan written by one model on its own route, and its figures filled in by another on theirs: not a backup.
      if (key.startsWith('filled:')) {
        void (async () => {
          await withModels('weekplan', async () => bill(0.4, 'claude-opus-5-5'), { models: ['claude-opus-5-5'] });
          await withModels('fill', async () => bill(0.02, 'gemini-3.8-flash'), { models: ['gemini-3.8-flash'] });
          resolve(WEEK);
        })();
      }
    }),
  onFail: async (device) => {
    givenBack.push(device);
  },
  failure: (error) => `no plan: ${(error as Error).message}`,
  cutOff: 'interrupted',
});

const askFor = (key: string): WeekPlanRequest => ({ ...ASK, preferences: key });
const waitFor = async <T>(check: () => T | undefined | Promise<T | undefined>): Promise<T> => {
  for (let i = 0; i < 300; i++) {
    const found = await check();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waited too long');
};
/** The latest run of a plan, once it has started. */
const runOf = (key: string) => waitFor(() => endings.get(key)?.at(-1));
/** How it ended, as its owner first reads it. */
const settle = (id: string, owner: string | null) =>
  waitFor(async () => {
    const job = await readJob(id, owner);
    return job?.status === 'working' ? undefined : job;
  });
/** Made and finished by its run, without being read (nobody looking). */
const finished = (id: string) =>
  waitFor(async () => {
    const rows = await query<{ status: string }>('select status from weekplan_jobs where id = $1', [id]);
    return rows[0]?.status === 'working' ? undefined : rows[0]?.status;
  });
const times = (list: (string | null)[], device: string | null) => list.filter((d) => d === device).length;

before(async () => {
  if (enabled) await migrate();
});
after(async () => {
  if (enabled) await closeDatabase();
});

async function aDevice() {
  const id = randomUUID();
  await query('insert into devices (id, token_hash) values ($1, $2)', [id, `hash-${id}`]);
  return id;
}

test('a plan is working, then done — counted the first time it is seen — and only its owner can read it', async () => {
  const device = enabled ? await aDevice() : null;
  const key = randomUUID();
  const id = await startJob({ deviceId: device, owner: device }, askFor(key));
  assert.deepEqual(await readJob(id, device), { status: 'working' }, 'answered at once, still thinking');
  (await runOf(key)).resolve(WEEK);
  assert.deepEqual(await settle(id, device), { status: 'done', plan: WEEK, firstTime: true });
  assert.deepEqual(await readJob(id, device), { status: 'done', plan: WEEK, firstTime: false }, 'seen again: not counted again');
  if (device) assert.equal(await readJob(id, 'somebody-else'), null, 'another browser cannot read it');
  assert.equal(await readJob('no-such-plan-here', device), null);
});

when('a plan made while nobody was looking waits to be seen, and is on the way (for the cap) until it is', async () => {
  const device = await aDevice();
  const key = randomUUID();
  assert.equal(await waitingJob(device), null);
  const id = await startJob({ deviceId: device, owner: device }, askFor(key));
  assert.equal(await waitingJob(device), id, 'being made');
  assert.equal(await plansOnTheWay(device), 1);
  (await runOf(key)).resolve(WEEK);
  assert.equal(await finished(id), 'done');
  assert.equal(await waitingJob(device), id, 'made, and not seen yet');
  assert.equal(await plansOnTheWay(device), 1, 'not counted yet, but not free either');
  assert.equal((await readJob(id, device))?.firstTime, true);
  assert.equal(await waitingJob(device), null, 'seen: nothing waiting');
  assert.equal(await plansOnTheWay(device), 0, 'counted now, so no longer on the way');
});

test('a plan that fails says why, and gives the question back', async () => {
  const device = enabled ? await aDevice() : randomUUID();
  const key = randomUUID();
  const id = await startJob({ deviceId: device, owner: device }, askFor(key));
  (await runOf(key)).reject(new Error('overloaded'));
  assert.deepEqual(await settle(id, device), { status: 'failed', error: 'no plan: overloaded' });
  await waitFor(() => (times(givenBack, device) ? true : undefined));
});

when('a plan whose server stopped part-way is made again by another, and counted once', async () => {
  const device = await aDevice();
  const key = randomUUID();
  const id = await startJob({ deviceId: device, owner: device }, askFor(key));
  const first = await runOf(key);
  // The server making it goes quiet: nothing has vouched for it in over a minute.
  await query(`update weekplan_jobs set heartbeat_at = now() - make_interval(secs => $2) where id = $1`, [id, DEAD_MS / 1000 + 5]);
  assert.deepEqual(await readJob(id, device), { status: 'working' }, 'asking after it notices, and it is being made again');
  const second = await waitFor(() => (endings.get(key)!.length === 2 ? endings.get(key)![1] : undefined));
  assert.equal((await query<{ attempts: number }>('select attempts from weekplan_jobs where id = $1', [id]))[0].attempts, 2);

  // The first one finishing late changes nothing: the job is not its to finish.
  first.resolve({ ...WEEK, summary: 'late' });
  second.resolve(WEEK);
  assert.deepEqual(await settle(id, device), { status: 'done', plan: WEEK, firstTime: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(await readJob(id, device), { status: 'done', plan: WEEK, firstTime: false }, 'the late first run did not replace it');
  assert.equal(times(givenBack, device), 0);
});

when('a plan handed over at shutdown is taken up at the next sweep, not a minute later', async () => {
  const device = await aDevice();
  const key = randomUUID();
  const id = await startJob({ deviceId: device, owner: device }, askFor(key));
  const first = await runOf(key);
  assert.ok((await handOver()) >= 1);
  assert.equal(first.signal.aborted, true, 'the plan being made here is stopped');
  await sweepJobs();
  const second = await waitFor(() => (endings.get(key)!.length === 2 ? endings.get(key)![1] : undefined));
  second.resolve(WEEK);
  assert.equal((await settle(id, device))?.status, 'done');
  assert.equal(times(givenBack, device), 0, 'stopping it for the hand-over is not a failure');
});

when('a plan cut off too often is failed by the sweep, and its question given back once, with nobody asking', async () => {
  const device = await aDevice();
  const key = randomUUID();
  const id = await startJob({ deviceId: device, owner: device }, askFor(key));
  await runOf(key);
  await query(`update weekplan_jobs set attempts = $2, heartbeat_at = now() - interval '1 hour' where id = $1`, [id, MAX_ATTEMPTS]);
  await sweepJobs();
  await sweepJobs();
  assert.equal(times(givenBack, device), 1);
  assert.deepEqual(await readJob(id, device), { status: 'failed', error: 'interrupted' });
  assert.equal(times(givenBack, device), 1, 'once, however often it is swept or asked after');
  assert.equal((await query<{ attempts: number }>('select attempts from weekplan_jobs where id = $1', [id]))[0].attempts, MAX_ATTEMPTS, 'the tries made, not one more');
});

when('a plan left from before plans could be made again (no request kept) is failed and given back', async () => {
  const device = await aDevice();
  const id = `old-${randomUUID()}`;
  await query(`insert into weekplan_jobs (id, device_id, owner, heartbeat_at) values ($1, $2, $2, now() - interval '5 minutes')`, [id, device]);
  await sweepJobs();
  assert.deepEqual(await readJob(id, device), { status: 'failed', error: 'interrupted' });
  assert.equal(times(givenBack, device), 1);
});

when('a plan still not made long after any plan takes is given up on, however lively', async () => {
  const device = await aDevice();
  const key = randomUUID();
  const id = await startJob({ deviceId: device, owner: device }, askFor(key));
  await runOf(key);
  await query(`update weekplan_jobs set created_at = now() - make_interval(secs => $2) where id = $1`, [id, STALE_MS / 1000 + 60]);
  await sweepJobs();
  assert.deepEqual(await readJob(id, device), { status: 'failed', error: 'interrupted' });
  assert.equal(times(givenBack, device), 1);
});

when('a refund takes one back, from the latest day that has one, never below nought', async () => {
  const device = await aDevice();
  const count = async () => Number((await query<{ n: string }>(`select coalesce(sum(count), 0) as n from usage where device_id = $1 and kind = 'chat'`, [device]))[0].n);
  await query(`insert into usage (device_id, day, kind, count) values ($1, current_date - 1, 'chat', 2)`, [device]);
  await spend(device, 'chat');
  assert.equal(await count(), 3);
  await refund(device, 'chat');
  assert.equal(await count(), 2);
  const today = await query<{ count: number }>(`select count from usage where device_id = $1 and kind = 'chat' and day = current_date`, [device]);
  assert.equal(today[0].count, 0, 'from today first, where the question was counted');
  await refund(device, 'chat');
  await refund(device, 'chat');
  await refund(device, 'chat');
  assert.equal(await count(), 0, 'and no further than nought');
});

when('a plan is made for where the person is — and still is when another server picks it up', async () => {
  const device = await aDevice();
  const key = randomUUID();
  // Asked from Boston, in kilocalories, in Spanish: the request's place, as the route sees it.
  const id = await inPlace({ region: 'US', energy: 'kcal', language: 'es' }, () => startJob({ deviceId: device, owner: device }, askFor(key)));
  const first = await runOf(key);
  assert.deepEqual(madeIn.get(key), ['US/kcal/es']);

  // The server making it stops; one with no request in hand takes it over.
  await query(`update weekplan_jobs set heartbeat_at = now() - make_interval(secs => $2) where id = $1`, [id, DEAD_MS / 1000 + 5]);
  await sweepJobs();
  const second = await waitFor(() => (endings.get(key)!.length === 2 ? endings.get(key)![1] : undefined));
  assert.deepEqual(madeIn.get(key), ['US/kcal/es', 'US/kcal/es'], 'the same place, not the server’s default');
  first.resolve(WEEK);
  second.resolve(WEEK);
  await settle(id, device);
});

when('a stored place that is not one, or none at all, is made for the defaults', async () => {
  const device = await aDevice();
  const key = randomUUID();
  const id = await startJob({ deviceId: device, owner: device }, askFor(key), { region: 'US', energy: 'kcal', language: 'en' });
  const first = await runOf(key);
  await query(`update weekplan_jobs set place = $2, heartbeat_at = now() - interval '5 minutes' where id = $1`, [
    id,
    JSON.stringify({ region: 'Atlantis', energy: 'joules', language: 'Klingon' }),
  ]);
  await sweepJobs();
  const second = await waitFor(() => (endings.get(key)!.length === 2 ? endings.get(key)![1] : undefined));
  assert.equal(madeIn.get(key)?.[1], 'GB/kcal/en', 'only known values ever reach a prompt');
  first.resolve(WEEK);
  second.resolve(WEEK);
  await settle(id, device);
});

when('a plan is made by the model that wrote it, not the one that filled in its figures after', async () => {
  const device = await aDevice();
  const key = `filled:${randomUUID()}`;
  const id = await startJob({ deviceId: device, owner: null }, askFor(key));
  assert.equal(await finished(id), 'done');
  const plan = await waitFor(async () => (await recentPlans(500)).find((p) => p.status === 'done' && p.costs.some((c) => c.model === 'claude-opus-5-5') && Math.abs((p.costUsd ?? 0) - 0.42) < 1e-9));
  assert.equal(plan.model, 'claude-opus-5-5', 'written by Opus, though Gemini answered last');
  assert.equal(plan.fillModel, 'gemini-3.8-flash');
  assert.deepEqual(plan.costs, [
    { model: 'claude-opus-5-5', usd: 0.4 },
    { model: 'gemini-3.8-flash', usd: 0.02 },
  ]);
});

when('a plan keeps which model made it and what every model asked for it cost, and adds it to the totals', async () => {
  const device = await aDevice();
  const key = `billed:${randomUUID()}`;
  const before = (await planCosts()).find((c) => c.model === 'claude-sonnet-5' && c.days === ASK.days && c.outcome === 'made');
  const id = await startJob({ deviceId: device, owner: null }, askFor(key));
  (await runOf(key)).resolve(WEEK);
  assert.equal(await finished(id), 'done');

  const plan = await waitFor(async () => {
    const found = (await recentPlans(500)).find((p) => p.costs.length === 2 && p.at && p.status === 'done' && p.costUsd !== null && Math.abs(p.costUsd - 0.2125) < 1e-9);
    return found;
  });
  assert.equal(plan.model, 'claude-sonnet-5', 'the model that answered last made it, its snapshot date left off');
  assert.deepEqual(plan.costs[0], { model: 'claude-sonnet-5', usd: 0.2 }, 'the maker first, before the backup it replaced');
  assert.deepEqual(plan.costs.at(-1), { model: 'gemini-3.8-flash', usd: 0.0125 });

  const after = (await planCosts()).find((c) => c.model === 'claude-sonnet-5' && c.days === ASK.days && c.outcome === 'made');
  assert.ok(after, 'counted in the totals kept after the job goes');
  assert.equal(after.plans - (before?.plans ?? 0), 1);
  assert.ok(Math.abs(after.usd - (before?.usd ?? 0) - 0.2125) < 1e-6, 'the whole plan, the failed model included');
});
