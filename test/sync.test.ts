import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GONE_FOR_MS, applyChange, changeOf, mergeDiaries, prune, stableJson, stamp, timesIn, type SyncTimes } from '../src/lib/sync';

/**
 * Two devices, one diary: what each did since they last agreed, put
 * together. Each "device" here is a diary and its times, stamped the way the
 * app stamps them — so a change made at 10:05 is a change made at 10:05.
 */

const meal = (id: string, title: string, calories = 500) => ({ id, date: '2026-10-01', slot: 'lunch', title, nutrients: { calories } });
const diary = (overrides: Record<string, unknown> = {}) => ({
  profile: { name: 'Sam', weightKg: 72, language: 'en' },
  targets: { calories: 1800, protein: 110 },
  meals: [meal('m1', 'Porridge', 350)],
  days: { '2026-10-01': { date: '2026-10-01', water: 3, steps: 4000 } },
  plans: [],
  favourites: [],
  recipes: [],
  notForMe: ['Liver and onions'],
  shopping: { ticked: ['oats'], extras: [{ id: 'x1', name: 'Washing-up liquid' }] },
  unlocked: { 'first-meal': '2026-09-20' },
  planLog: [],
  theme: 'system',
  ...overrides,
});

/** A device: its diary, stamped at a time. */
class Device {
  diary: Record<string, unknown>;
  times: SyncTimes = {};
  constructor(start: Record<string, unknown>, at: number) {
    this.diary = structuredClone(start);
    this.times = stamp(this.diary, {}, at).times;
  }
  change(at: number, edit: (d: Record<string, unknown>) => void): this {
    edit(this.diary);
    this.times = stamp(this.diary, this.times, at).times;
    return this;
  }
  /** Take the other's copy in, as the app does when the server hands it back. */
  meet(other: Device, at = 10_000): ReturnType<typeof mergeDiaries> {
    const merged = mergeDiaries(this.diary, this.times, other.diary, other.times, at);
    this.diary = merged.diary;
    this.times = merged.times;
    return merged;
  }
}

const titles = (d: Record<string, unknown>) => (d.meals as { title: string }[]).map((m) => m.title);

test('the same diary on both is the same diary after', () => {
  const a = new Device(diary(), 1);
  const b = new Device(diary(), 1);
  const { diary: merged, took, dropped } = a.meet(b);
  assert.equal(stableJson(merged), stableJson(diary()), 'nothing lost, nothing changed, in any part');
  assert.deepEqual([took, dropped], [0, 0]);
});

test('lunch logged on the phone and dinner on the iPad: both, on both', () => {
  const phone = new Device(diary(), 1).change(100, (d) => (d.meals as unknown[]).push(meal('m2', 'Chicken wrap')));
  const ipad = new Device(diary(), 1).change(120, (d) => (d.meals as unknown[]).push({ ...meal('m3', 'Salmon traybake', 650), slot: 'dinner' }));
  assert.deepEqual(titles(phone.meet(ipad).diary), ['Porridge', 'Chicken wrap', 'Salmon traybake']);
  assert.deepEqual(titles(ipad.meet(phone).diary).sort(), ['Chicken wrap', 'Porridge', 'Salmon traybake']);
});

test('two lunches with the same name are two lunches: ids, not guesses', () => {
  const phone = new Device(diary(), 1).change(100, (d) => (d.meals as unknown[]).push(meal('m2', 'Chicken wrap')));
  const ipad = new Device(diary(), 1).change(100, (d) => (d.meals as unknown[]).push(meal('m9', 'Chicken wrap')));
  assert.deepEqual(titles(phone.meet(ipad).diary), ['Porridge', 'Chicken wrap', 'Chicken wrap']);
});

test('deleted on one device stays deleted, unless the other changed it afterwards', () => {
  const start = diary({ meals: [meal('m1', 'Porridge'), meal('m2', 'Toast')] });
  const phone = new Device(start, 1).change(200, (d) => (d.meals = (d.meals as { id: string }[]).filter((m) => m.id !== 'm2')));
  const ipad = new Device(start, 1);
  const { dropped } = ipad.meet(phone);
  assert.deepEqual(titles(ipad.diary), ['Porridge'], 'the toast went on the iPad too');
  assert.equal(dropped, 1);

  // The iPad corrected the toast after the phone deleted it: the correction wins.
  const phone2 = new Device(start, 1).change(200, (d) => (d.meals = (d.meals as { id: string }[]).filter((m) => m.id !== 'm2')));
  const ipad2 = new Device(start, 1).change(300, (d) => ((d.meals as { id: string; title: string }[])[1].title = 'Toast and jam'));
  assert.deepEqual(titles(phone2.meet(ipad2).diary), ['Porridge', 'Toast and jam']);
});

test('the same meal changed on both: the later change', () => {
  const phone = new Device(diary(), 1).change(100, (d) => ((d.meals as { nutrients: { calories: number } }[])[0].nutrients.calories = 400));
  const ipad = new Device(diary(), 1).change(150, (d) => ((d.meals as { title: string }[])[0].title = 'Porridge with banana'));
  const merged = phone.meet(ipad).diary.meals as { title: string; nutrients: { calories: number } }[];
  assert.equal(merged[0].title, 'Porridge with banana', 'the later change, whole: a meal is one part');
});

test('settings merge field by field: weight on one, language on the other', () => {
  const phone = new Device(diary(), 1).change(100, (d) => ((d.profile as { weightKg: number }).weightKg = 71.4));
  const ipad = new Device(diary(), 1).change(110, (d) => ((d.profile as { language: string }).language = 'es'));
  const profile = phone.meet(ipad).diary.profile as { weightKg: number; language: string; name: string };
  assert.deepEqual(profile, { name: 'Sam', weightKg: 71.4, language: 'es' });
});

test('days, badges, sets and the shopping list each merge by their parts', () => {
  const phone = new Device(diary(), 1).change(100, (d) => {
    (d.days as Record<string, unknown>)['2026-10-02'] = { date: '2026-10-02', water: 5, steps: 9000 };
    (d.notForMe as string[]).push('Tofu');
    (d.shopping as { ticked: string[] }).ticked = []; // un-ticked the oats
  });
  const ipad = new Device(diary(), 1).change(100, (d) => {
    ((d.days as Record<string, { water: number }>)['2026-10-01']).water = 6;
    (d.unlocked as Record<string, string>).streak7 = '2026-10-01';
    (d.shopping as { extras: unknown[] }).extras.push({ id: 'x2', name: 'Foil' });
  });
  const merged = phone.meet(ipad).diary as Record<string, never>;
  assert.equal((merged.days as Record<string, { water: number }>)['2026-10-01'].water, 6);
  assert.equal((merged.days as Record<string, { steps: number }>)['2026-10-02'].steps, 9000);
  assert.deepEqual(merged.notForMe, ['Liver and onions', 'Tofu']);
  assert.deepEqual(Object.keys(merged.unlocked).sort(), ['first-meal', 'streak7']);
  assert.deepEqual((merged.shopping as { ticked: string[] }).ticked, [], 'the oats un-ticked stay un-ticked');
  assert.deepEqual((merged.shopping as { extras: { name: string }[] }).extras.map((e) => e.name), ['Washing-up liquid', 'Foil']);
});

test('a list emptied on one device comes back empty, not missing', () => {
  const phone = new Device(diary({ plans: [meal('p1', 'Chilli')] }), 1).change(100, (d) => (d.plans = []));
  const ipad = new Device(diary({ plans: [meal('p1', 'Chilli')] }), 1);
  const merged = ipad.meet(phone).diary;
  assert.deepEqual(merged.plans, []);
  assert.ok(Array.isArray(merged.recipes), 'containers both had stay, even empty');
});

test('a copy from an app without times: everything kept, this device wins where they differ', () => {
  const phone = new Device(diary(), 1).change(100, (d) => (d.meals as unknown[]).push(meal('m2', 'Chicken wrap')));
  const old = { ...diary({ meals: [meal('m1', 'Porridge with honey'), meal('m5', 'Soup')] }) };
  const { diary: merged } = mergeDiaries(phone.diary, phone.times, old, timesIn(old));
  assert.deepEqual(titles(merged), ['Porridge', 'Chicken wrap', 'Soup']);
});

test('stamping: what changed is stamped, what went is remembered, and only for parts this copy has', () => {
  const start = diary();
  const first = stamp(start, {}, 10);
  assert.ok(first.changed);
  const again = stamp(start, first.times, 20);
  assert.equal(again.changed, false, 'nothing changed: nothing stamped');
  assert.equal(again.times, first.times);

  const without = { ...structuredClone(start), meals: [] };
  const gone = stamp(without, first.times, 30);
  assert.ok(Object.entries(gone.times).some(([part, e]) => part.startsWith('meals') && e.gone && e.t === 30));

  // A diary sent without one of its containers (past chats, when they are not backed up) has not deleted it.
  const { theme: _theme, ...noTheme } = start;
  assert.ok(!Object.values(stamp(noTheme, first.times, 40).times).some((e) => e.gone));
});

test('deletions are remembered long enough, then let go', () => {
  const times: SyncTimes = { a: { t: 0, h: '', gone: 1 }, b: { t: 0, h: 'x' } };
  assert.equal(prune(times, GONE_FOR_MS - 1), times);
  assert.deepEqual(Object.keys(prune(times, GONE_FOR_MS + 1)), ['b']);
});

test('fingerprints do not depend on the order keys were written in', () => {
  assert.equal(stableJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } }), stableJson({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }));
});

test('chats deleted by hand on either device are deleted on both', () => {
  const phone = new Device(diary({ chatsGone: {} }), 1).change(100, (d) => ((d.chatsGone as Record<string, number>).chat_a = 100));
  const ipad = new Device(diary({ chatsGone: {} }), 1).change(120, (d) => ((d.chatsGone as Record<string, number>).chat_b = 120));
  assert.deepEqual(phone.meet(ipad).diary.chatsGone, { chat_a: 100, chat_b: 120 });
});

/* ------------------------------------------------------------------ *
 * What changed, sent on its own.
 * ------------------------------------------------------------------ */

/** What a device would send: the parts stamped since it last saved. */
function changed(device: Device, edit: (d: Record<string, unknown>) => void, at: number) {
  edit(device.diary);
  const found = stamp(device.diary, device.times, at);
  device.times = found.times;
  return changeOf(device.diary, device.times, found.parts);
}

test('a change is only what changed: one lunch, not the diary', () => {
  const phone = new Device(diary({ meals: Array.from({ length: 200 }, (_, i) => meal(`m${i}`, `Meal ${i}`)) }), 1);
  const change = changed(phone, (d) => (d.meals as unknown[]).push(meal('lunch', 'Chicken wrap')), 100);
  assert.deepEqual(Object.keys(change.parts).map((k) => k.split('\u0001')[1]), ['lunch']);
  assert.ok(JSON.stringify(change).length < 1_000, `a few hundred bytes, not ${JSON.stringify(phone.diary).length}`);
  assert.ok(change.containers.includes('meals'));
});

test('a change put into another copy: the same as merging the whole diaries', () => {
  const start = diary({ meals: [meal('m1', 'Porridge'), meal('m2', 'Toast')] });
  const phone = new Device(start, 1);
  const ipad = new Device(start, 1);
  const fromPhone = changed(phone, (d) => {
    (d.meals as unknown[]).push(meal('m3', 'Chicken wrap'));
    d.meals = (d.meals as { id: string }[]).filter((m) => m.id !== 'm2');
    (d.profile as { weightKg: number }).weightKg = 71.2;
  }, 200);
  ipad.change(150, (d) => ((d.profile as { language: string }).language = 'es'));

  const applied = applyChange(ipad.diary, ipad.times, fromPhone, 10_000);
  const merged = mergeDiaries(ipad.diary, ipad.times, phone.diary, phone.times, 10_000);
  assert.equal(stableJson(applied.diary), stableJson(merged.diary), 'by parts or whole, one answer');
  assert.deepEqual(titles(applied.diary), ['Porridge', 'Chicken wrap']);
  assert.deepEqual(applied.diary.profile, { name: 'Sam', weightKg: 71.2, language: 'es' });
  assert.equal(applied.dropped, 1);
});

test('the later change wins either way round, and an earlier one is not taken', () => {
  const ipad = new Device(diary(), 1);
  const phone = new Device(diary(), 1);
  const later = changed(phone, (d) => ((d.meals as { title: string }[])[0].title = 'Porridge with banana'), 300);
  const earlier = changed(ipad, (d) => ((d.meals as { title: string }[])[0].title = 'Porridge with honey'), 200);
  const onIpad = applyChange(ipad.diary, ipad.times, later);
  assert.equal(titles(onIpad.diary)[0], 'Porridge with banana');
  assert.equal(onIpad.taken.length, 1);
  const onPhone = applyChange(phone.diary, phone.times, earlier);
  assert.equal(titles(onPhone.diary)[0], 'Porridge with banana', 'the phone keeps its later change');
  assert.deepEqual(onPhone.taken, [], 'and says it did not take the earlier one');
});

test('a deletion wins over a change made at the same moment, and loses to one made after', () => {
  const start = diary({ meals: [meal('m1', 'Porridge'), meal('m2', 'Toast')] });
  const phone = new Device(start, 1);
  const gone = changed(phone, (d) => (d.meals = (d.meals as { id: string }[]).filter((m) => m.id !== 'm2')), 500);
  const same = new Device(start, 1).change(500, (d) => ((d.meals as { title: string }[])[1].title = 'Toast and jam'));
  assert.deepEqual(titles(applyChange(same.diary, same.times, gone).diary), ['Porridge']);
  const after = new Device(start, 1).change(600, (d) => ((d.meals as { title: string }[])[1].title = 'Toast and jam'));
  assert.deepEqual(titles(applyChange(after.diary, after.times, gone).diary), ['Porridge', 'Toast and jam']);
});

test('a change keeps the order of what it does not mention, and an emptied list arrives empty', () => {
  const ipad = new Device(diary({ meals: [meal('a', 'A'), meal('b', 'B'), meal('c', 'C')], plans: [meal('p1', 'Chilli')] }), 1);
  const phone = new Device(diary({ meals: [meal('a', 'A'), meal('b', 'B'), meal('c', 'C')], plans: [meal('p1', 'Chilli')] }), 1);
  const change = changed(phone, (d) => {
    (d.meals as { title: string }[])[1].title = 'B, changed';
    d.plans = [];
  }, 100);
  const applied = applyChange(ipad.diary, ipad.times, change);
  assert.deepEqual(titles(applied.diary), ['A', 'B, changed', 'C']);
  assert.deepEqual(applied.diary.plans, []);
});

test('nonsense in a change is left out, not put in the diary', () => {
  const ipad = new Device(diary(), 1);
  const applied = applyChange(ipad.diary, ipad.times, {
    parts: { 'meals\u0001x': meal('x', 'Real'), 'pastChats\u0001y': 'no', 'nokey': 1 },
    times: { 'meals\u0001x': { t: 5, h: 'a' }, 'pastChats\u0001y': { t: 5, h: 'a' }, 'nokey': { t: 5, h: 'a' }, 'meals\u0001z': { t: 'soon' } as never },
    containers: ['meals', '_sync', 'pastChats'],
  });
  assert.deepEqual(titles(applied.diary), ['Porridge', 'Real']);
  assert.ok(!('pastChats' in applied.diary) && !('_sync' in applied.diary) && !('nokey' in applied.diary));
});
