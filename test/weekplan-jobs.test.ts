import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { refund, spend } from '../server/identity';
import { STALE_MS, readJob, startJob } from '../server/weekplanJobs';
import type { WeekPlan } from '../server/claude';

/**
 * A weekly plan is made in the background and asked after, so a slow one is
 * never lost to a timeout; and one that fails gives its question back.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

before(async () => {
  if (enabled) await migrate();
});
after(async () => {
  if (enabled) await closeDatabase();
});

const WEEK: WeekPlan = { summary: 'A calm week', days: [{ date: '2026-09-28', meals: [], calories: 1800, underFloor: false }] };
const settle = async (id: string, owner: string | null) => {
  for (let i = 0; i < 100; i++) {
    const job = await readJob(id, owner, async () => {}, 'cut off');
    if (job?.status !== 'working') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return readJob(id, owner, async () => {}, 'cut off');
};

async function aDevice() {
  const id = randomUUID();
  await query('insert into devices (id, token_hash) values ($1, $2)', [id, `hash-${id}`]);
  return id;
}

test('a plan is working, then done — and only its owner can read it', async () => {
  const device = enabled ? await aDevice() : null;
  let finish!: (plan: WeekPlan) => void;
  const id = await startJob({ deviceId: device, owner: device }, () => new Promise<WeekPlan>((resolve) => (finish = resolve)), async () => {}, () => 'failed');
  assert.deepEqual(await readJob(id, device, async () => {}, 'cut off'), { status: 'working' }, 'answered at once, still thinking');
  finish(WEEK);
  assert.deepEqual(await settle(id, device), { status: 'done', plan: WEEK });
  if (device) assert.equal(await readJob(id, 'somebody-else', async () => {}, 'cut off'), null, 'another browser cannot read it');
  assert.equal(await readJob('no-such-plan-here', device, async () => {}, 'cut off'), null);
});

test('a plan that fails says why, and gives the question back', async () => {
  const device = enabled ? await aDevice() : null;
  const given: (string | null)[] = [];
  const id = await startJob(
    { deviceId: device, owner: device },
    async () => {
      throw new Error('overloaded');
    },
    async (who) => {
      given.push(who);
    },
    (error) => `no plan: ${(error as Error).message}`,
  );
  assert.deepEqual(await settle(id, device), { status: 'failed', error: 'no plan: overloaded' });
  assert.deepEqual(given, [device]);
});

when('a plan cut off by a restart is failed when next asked after, and its question given back once', async () => {
  const device = await aDevice();
  const id = `stale-${randomUUID()}`;
  await query(`insert into weekplan_jobs (id, device_id, owner, created_at) values ($1, $2, $2, now() - make_interval(secs => $3))`, [
    id,
    device,
    STALE_MS / 1000 + 60,
  ]);
  const given: (string | null)[] = [];
  const onStale = async (who: string | null) => {
    given.push(who);
  };
  assert.deepEqual(await readJob(id, device, onStale, 'interrupted'), { status: 'failed', error: 'interrupted' });
  assert.deepEqual(await readJob(id, device, onStale, 'interrupted'), { status: 'failed', error: 'interrupted' });
  assert.deepEqual(given, [device], 'given back once, however often it is asked after');
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
