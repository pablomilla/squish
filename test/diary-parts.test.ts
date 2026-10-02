import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { diaryChanges, patchDiary, readDiary, writeDiary } from '../server/diary';
import { applyChange, changeOf, stamp, type SyncTimes } from '../src/lib/sync';

/**
 * Saving what changed rather than the whole diary, against a real Postgres:
 * devices that send their parts, a server that merges them by the same rules
 * and answers with what the others changed, and a device behind being sent
 * the whole diary where parts cannot say enough.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

before(async () => {
  if (enabled) await migrate();
});
after(async () => {
  if (enabled) await closeDatabase();
});

const owner = () => `parts-${Math.random().toString(36).slice(2)}`;
const meal = (id: string, title: string) => ({ id, date: '2026-10-02', slot: 'lunch', title, nutrients: { calories: 400 } });
const start = () => ({ profile: { name: 'Sam', weightKg: 72 }, meals: [meal('m1', 'Porridge')], plans: [], days: {} });
const titles = (state: unknown) => ((state as { meals: { title: string }[] }).meals ?? []).map((m) => m.title);

/** A device keeping in step by parts, as src/lib/autobackup.ts does. */
class Device {
  diary: Record<string, unknown>;
  times: SyncTimes;
  version: number;
  pending = new Set<string>();
  private owner: string;
  constructor(owner: string, diary: Record<string, unknown>, times: SyncTimes, version: number) {
    this.owner = owner;
    this.diary = structuredClone(diary);
    this.times = times;
    this.version = version;
  }
  edit(at: number, change: (d: Record<string, unknown>) => void): this {
    change(this.diary);
    const found = stamp(this.diary, this.times, at);
    this.times = found.times;
    for (const part of found.parts) this.pending.add(part);
    return this;
  }
  async save(now = 10_000) {
    const sent = changeOf(this.diary, this.times, this.pending);
    const result = await patchDiary(this.owner, this.version, sent, undefined, now);
    assert.ok(result.ok, `saved: ${JSON.stringify(result)}`);
    this.pending.clear();
    if ('whole' in result) throw new Error('expected parts back');
    const applied = applyChange(this.diary, this.times, result.change, now);
    this.diary = applied.diary;
    this.times = applied.times;
    this.version = result.version;
    return { sent, result };
  }
}

/** An account's diary written whole, as the first device does, and two devices in step with it. */
async function twoDevices() {
  const who = owner();
  const first = new Device(who, start(), stamp(start(), {}, 1).times, 0);
  const written = await writeDiary(who, { ...first.diary, _sync: { times: first.times } }, null);
  assert.ok(written.ok);
  const phone = new Device(who, first.diary, first.times, written.version);
  const ipad = new Device(who, first.diary, first.times, written.version);
  return { who, phone, ipad };
}

when('a lunch is saved as the lunch: the server puts it in, and the next device is sent only it', async () => {
  const { who, phone } = await twoDevices();
  const { sent, result } = await phone.edit(100, (d) => (d.meals as unknown[]).push(meal('m2', 'Chicken wrap'))).save();
  assert.equal(Object.keys(sent.parts).length, 1);
  assert.ok(result.ok && 'change' in result && Object.keys(result.change.times).length === 0, 'nothing else had changed: nothing comes back');
  assert.deepEqual(titles((await readDiary(who))!.state), ['Porridge', 'Chicken wrap']);

  const since = await diaryChanges(who, 1);
  assert.equal(since?.kind, 'changes');
  if (since?.kind !== 'changes') return;
  assert.equal(since.version, 2);
  assert.deepEqual(Object.values(since.change.parts).map((m) => (m as { title: string }).title), ['Chicken wrap']);
  assert.deepEqual(await diaryChanges(who, 2), { kind: 'same', version: 2 });
});

when('two devices saving from the same version are both kept, and each is told of the other', async () => {
  const { who, phone, ipad } = await twoDevices();
  await phone.edit(100, (d) => (d.meals as unknown[]).push(meal('m2', 'Chicken wrap'))).save();
  // The iPad has not heard: it saves from version 1 all the same, and is not refused.
  const { result } = await ipad.edit(120, (d) => (d.profile as { weightKg: number }).weightKg = 71.4).save();
  assert.ok(result.ok && 'change' in result);
  assert.deepEqual(titles(ipad.diary), ['Porridge', 'Chicken wrap'], 'the phone’s lunch came back with the answer');
  const held = (await readDiary(who))!;
  assert.deepEqual(titles(held.state), ['Porridge', 'Chicken wrap']);
  assert.equal((held.state as { profile: { weightKg: number } }).profile.weightKg, 71.4);
  assert.equal(held.version, 3);
});

when('the same meal changed on both: the later change, wherever it was saved first', async () => {
  const { who, phone, ipad } = await twoDevices();
  await phone.edit(300, (d) => ((d.meals as { title: string }[])[0].title = 'Porridge with banana')).save();
  // Changed earlier on the iPad (its clock behind, or saved late): the server keeps the later, and says so.
  await ipad.edit(200, (d) => ((d.meals as { title: string }[])[0].title = 'Porridge with honey')).save();
  assert.deepEqual(titles((await readDiary(who))!.state), ['Porridge with banana']);
  assert.deepEqual(titles(ipad.diary), ['Porridge with banana'], 'the iPad does not go on holding its own');
});

when('a deletion is saved as a deletion, and reaches the other device as one', async () => {
  const { who, phone, ipad } = await twoDevices();
  await phone.edit(100, (d) => (d.meals = [])).save();
  assert.deepEqual(titles((await readDiary(who))!.state), []);
  const since = await diaryChanges(who, 1);
  assert.ok(since?.kind === 'changes');
  const applied = applyChange(ipad.diary, ipad.times, since.change);
  assert.deepEqual(applied.diary.meals, [], 'gone, and the list still there');
});

when('past chats are merged with the ones kept, and null stops keeping them', async () => {
  const { who, phone } = await twoDevices();
  const chat = (id: string, updatedAt: number) => ({ id, title: id, startedAt: 1, updatedAt, turns: [{ role: 'user', text: 'hi', at: 1 }] });
  const now = Date.now();
  await patchDiary(who, phone.version, changeOf(phone.diary, phone.times, []), [chat('c1', now)]);
  const second = await patchDiary(who, phone.version, changeOf(phone.diary, phone.times, []), [chat('c2', now)]);
  assert.ok(second.ok && 'pastChats' in second, 'the chat it had not sent comes back');
  assert.deepEqual(((await readDiary(who))!.state as { pastChats: { id: string }[] }).pastChats.map((c) => c.id).sort(), ['c1', 'c2']);
  await patchDiary(who, 3, changeOf(phone.diary, phone.times, []), null);
  assert.ok(!('pastChats' in ((await readDiary(who))!.state as object)), 'turned off: not kept here');
});

when('a diary written before parts were tracked is sent whole, until a write tracks it', async () => {
  const who = owner();
  const diary = { ...start(), _sync: { times: stamp(start(), {}, 1).times } };
  await query('insert into diaries (owner_id, state, version) values ($1, $2, 4)', [who, diary]);
  assert.equal((await diaryChanges(who, 3))?.kind, 'whole');
  const device = new Device(who, start(), diary._sync.times, 4);
  await device.edit(100, (d) => (d.meals as unknown[]).push(meal('m2', 'Soup'))).save();
  assert.equal((await diaryChanges(who, 4))?.kind, 'changes', 'from the version it was tracked from');
  assert.equal((await diaryChanges(who, 3))?.kind, 'whole', 'but not before');
  // A device behind that saves is saved, and sent the whole diary to start again from.
  const behind = await patchDiary(who, 3, changeOf(start(), diary._sync.times, []));
  assert.ok(behind.ok && 'whole' in behind && titles(behind.whole.state).includes('Soup'));
});

when('a deletion let go of after four months sends a device that never heard of it the whole diary', async () => {
  const { who, phone } = await twoDevices();
  const long = 200 * 24 * 60 * 60 * 1000;
  await phone.edit(1000, (d) => (d.meals = [])).save(2000); // deleted at version 2
  await phone.edit(long, (d) => (d.profile as { weightKg: number }).weightKg = 70).save(long); // the deletion is let go of here
  assert.equal((await diaryChanges(who, 1))?.kind, 'whole', 'version 1 never heard of the deletion');
  assert.equal((await diaryChanges(who, 2))?.kind, 'changes', 'version 2 did');
});

when('a whole diary written by an app that keeps no times leaves every device behind it to start again', async () => {
  const { who, phone } = await twoDevices();
  await writeDiary(who, { meals: [meal('m9', 'From an old app')] }, 1);
  assert.equal((await diaryChanges(who, phone.version))?.kind, 'whole');
});

when('no diary, or a different one begun since: the device is told to send the whole', async () => {
  const empty = changeOf({}, {}, []);
  assert.deepEqual(await patchDiary(owner(), 1, empty), { ok: false, reason: 'missing' });
  const { who } = await twoDevices();
  assert.deepEqual(await patchDiary(who, 9, empty), { ok: false, reason: 'reset' });
});

when('a change that would make the diary too large is refused, and nothing is written', async () => {
  const { who, phone } = await twoDevices();
  phone.edit(100, (d) => (d.meals as unknown[]).push({ ...meal('big', 'Big'), note: 'x'.repeat(6_100_000) }));
  const result = await patchDiary(who, phone.version, changeOf(phone.diary, phone.times, phone.pending));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'too_big');
  assert.equal((await readDiary(who))!.version, 1);
});
