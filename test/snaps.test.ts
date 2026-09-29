import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import type { AnalysisResult } from '../src/types';
import { ABANDONED_MS, DEAD_MS, MAX_ATTEMPTS, cleanSnap, forgetSnaps, knownSnap, setSnapWorker, snapsFor, startSnap, sweepSnaps, type SnapAsk } from '../server/snaps';
import { currentPlace, inPlace } from '../server/region';
import { closeDatabase, hasDatabase, query } from '../server/db';
import { registerDevice } from '../server/identity';

// With a database, snaps belong to devices that exist; without one, any name will do.
const devices = new Map<string, string>();
const dev = async (name: string): Promise<string> => {
  if (!hasDatabase()) return name;
  if (!devices.has(name)) devices.set(name, (await registerDevice()).id);
  return devices.get(name)!;
};
after(async () => {
  if (hasDatabase()) await closeDatabase();
});

/**
 * Quick snaps: handed over in a second, read in the background whether or
 * not the app is still open, collected the next time it is. (In memory here;
 * the database keeps them the same way.)
 */

const IMAGE = `data:image/jpeg;base64,${'A'.repeat(400)}`;
const meal = (title: string): AnalysisResult => ({
  title, items: [], nutrients: { calories: 500, protein: 30, carbs: 50, fat: 15, fibre: 6, sugar: 5, sodium: 400 },
  score: 70, coachNote: '', confidence: 'medium',
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

let reads: SnapAsk[] = [];
let answer: (ask: SnapAsk) => Promise<AnalysisResult> = async (ask) => meal(`Read ${ask.id}`);
const refunds: string[] = [];
setSnapWorker({
  read: (ask) => {
    reads.push(ask);
    return answer(ask);
  },
  onFail: async (deviceId) => void refunds.push(deviceId),
  failure: () => 'Squish could not read this photo.',
});

test('a snap is checked: an id of its own, when it was taken, and a photo', () => {
  const ask = cleanSnap({ id: 'snap_12345678', image: IMAGE, date: '2026-09-29', time: '12:41', slot: 'lunch', crockery: { plateCm: 27, bowlMl: 9000 } })!;
  assert.equal(ask.mediaType, 'image/jpeg');
  assert.equal(ask.image, 'A'.repeat(400), 'the photo without its data: prefix');
  assert.deepEqual(ask.crockery, { plateCm: 27 }, 'a bowl that size is not a bowl');
  assert.equal(cleanSnap({ id: 'snap_12345678', image: IMAGE, date: '2026-09-29', time: '12:41', slot: 'elevenses' })!.slot, undefined);
  assert.equal(cleanSnap({ id: 'x', image: IMAGE, date: '2026-09-29', time: '12:41' }), null, 'an id too short to be unique');
  assert.equal(cleanSnap({ id: 'snap_12345678', image: 'data:text/html;base64,AAAA', date: '2026-09-29', time: '12:41' }), null, 'not a photo');
  assert.equal(cleanSnap({ id: 'snap_12345678', image: IMAGE, date: 'yesterday', time: '12:41' }), null);
});

test('a snap is read in the background, where they are, and collected once', async () => {
  const deva = await dev('dev-a');
  const devb = await dev('dev-b');
  reads = [];
  const place = { region: 'US' as const, energy: 'kcal' as const, language: 'es' as const };
  let readIn: string | undefined;
  answer = async (ask) => {
    readIn = currentPlace().language;
    return meal(`Read ${ask.id}`);
  };
  await startSnap(deva, cleanSnap({ id: 'snap_aaaaaaa1', image: IMAGE, date: '2026-09-29', time: '12:41', slot: 'lunch' })!, true, place);
  assert.equal(await knownSnap(deva, 'snap_aaaaaaa1'), true);
  assert.equal(await knownSnap(devb, 'snap_aaaaaaa1'), false, 'the same id from another phone is another snap');
  await settle();
  const [snap] = await snapsFor(deva);
  assert.equal(snap.status, 'done');
  assert.equal(snap.analysis?.title, 'Read snap_aaaaaaa1');
  assert.deepEqual([snap.date, snap.time, snap.slot], ['2026-09-29', '12:41', 'lunch'], 'logged for when it was taken');
  assert.equal(readIn, 'es', 'read in their language, though the request that brought it has gone');
  assert.deepEqual(await snapsFor(devb), []);
  await forgetSnaps(deva, ['snap_aaaaaaa1']);
  assert.deepEqual(await snapsFor(deva), [], 'gone once collected');
});

test('a snap that cannot be read says so, and gives back the photo read if it was counted', async () => {
  const devc = await dev('dev-c');
  refunds.length = 0;
  answer = async () => {
    throw new Error('overloaded');
  };
  await inPlace({ region: 'GB', energy: 'kcal', language: 'en' }, async () => {
    await startSnap(devc, cleanSnap({ id: 'snap_ccccccc1', image: IMAGE, date: '2026-09-29', time: '19:02' })!, true);
    await startSnap(devc, cleanSnap({ id: 'snap_ccccccc2', image: IMAGE, date: '2026-09-29', time: '19:03' })!, false);
  });
  await settle();
  const snaps = await snapsFor(devc);
  assert.deepEqual(snaps.map((s) => s.status), ['failed', 'failed']);
  assert.equal(snaps[0].error, 'Squish could not read this photo.');
  assert.deepEqual(refunds, [devc], 'only the one that was counted');
});

test('a read cut off by a restart is started again when the app next asks, and failed after its tries', async () => {
  const devd = await dev('dev-d');
  refunds.length = 0;
  reads = [];
  // Never answers: the instance reading it has gone.
  answer = () => new Promise<AnalysisResult>(() => {});
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    await startSnap(devd, cleanSnap({ id: 'snap_ddddddd1', image: IMAGE, date: '2026-09-29', time: '08:10' })!, true);
    assert.equal((await snapsFor(devd))[0].status, 'working');
    assert.equal(reads.length, 1, 'not taken over while it is still fresh');
    for (let n = 2; n <= MAX_ATTEMPTS; n++) {
      mock.timers.tick(DEAD_MS + 1);
      await snapsFor(devd);
      assert.equal(reads.length, n, `try ${n}`);
      assert.equal(reads.at(-1)?.image, 'A'.repeat(400), 'the photo is kept for another try');
    }
    mock.timers.tick(DEAD_MS + 1);
    const [snap] = await snapsFor(devd);
    assert.equal(snap.status, 'failed');
    assert.equal(reads.length, MAX_ATTEMPTS, 'no more tries');
    assert.deepEqual(refunds, [devd]);
  } finally {
    mock.timers.reset();
  }
});

test('a snap still being read is not forgotten by collecting it', async () => {
  const deve = await dev('dev-e');
  answer = () => new Promise<AnalysisResult>(() => {});
  await startSnap(deve, cleanSnap({ id: 'snap_eeeeeee1', image: IMAGE, date: '2026-09-29', time: '08:10' })!, true);
  await forgetSnaps(deve, ['snap_eeeeeee1', '../../etc']);
  assert.equal((await snapsFor(deve)).length, 1);
});

test('a read nobody came back for is failed within the hour and its photo let go; a week on, it is gone', async () => {
  const devf = await dev('dev-f');
  refunds.length = 0;
  answer = () => new Promise<AnalysisResult>(() => {});
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    await startSnap(devf, cleanSnap({ id: 'snap_fffffff1', image: IMAGE, date: '2026-09-29', time: '08:10' })!, true);
    await sweepSnaps();
    assert.equal((await snapsFor(devf))[0].status, 'working', 'not while it may still be read');
    mock.timers.tick(ABANDONED_MS + 1);
    // The database keeps its own time: the row is made older instead.
    if (hasDatabase()) await query(`update snaps set claimed_at = claimed_at - interval '31 minutes' where device_id = $1`, [devf]);
    await sweepSnaps(Date.now());
    const [snap] = await snapsFor(devf);
    assert.equal(snap.status, 'failed');
    assert.deepEqual(refunds.filter((id) => id === devf), [devf], 'the photo read given back, once');
  } finally {
    mock.timers.reset();
  }
  if (hasDatabase()) await query(`update snaps set created_at = created_at - interval '8 days' where device_id = $1`, [devf]);
  await sweepSnaps(Date.now() + 8 * 86_400_000);
  assert.deepEqual(await snapsFor(devf), [], 'a week on, nothing is left');
});
