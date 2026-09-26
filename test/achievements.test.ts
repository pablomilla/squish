import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS, earnedFrom } from '../src/lib/achievements';
import { addDays } from '../src/lib/date';
import type { DayLog, MealEntry, MealSlot, Targets } from '../src/types';

/**
 * Badges are worked out from the diary. The ones that matter most are the
 * forgiving ones — total days and "welcome back" — and the ones that must
 * never exist: nothing for eating less or weighing less.
 */
const TODAY = '2026-09-25';
const targets = { calories: 2000, protein: 100, fibre: 30, water: 8 } as Targets;
let n = 0;
const meal = (date: string, over: Partial<MealEntry> = {}): MealEntry => ({
  id: `m${n++}`,
  date,
  time: '12:00',
  slot: 'lunch' as MealSlot,
  title: 'Lunch',
  items: [{ id: `i${n}`, name: `Food ${n}`, portion: '1', nutrients: { calories: 500, protein: 20, carbs: 50, fat: 15, fibre: 5 } }],
  nutrients: { calories: 500, protein: 20, carbs: 50, fat: 15, fibre: 5 },
  score: 60,
  source: 'describe',
  ...over,
});
const run = (from: string, count: number, over: Partial<MealEntry> = {}) =>
  Array.from({ length: count }, (_, i) => meal(addDays(from, i), over));
const earned = (meals: MealEntry[], days: Record<string, DayLog> = {}) => new Set(earnedFrom({ meals, days, targets }, TODAY));

test('the catalogue: unique ids, every one in a group, and nothing about eating or weighing less', () => {
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  assert.ok(ACHIEVEMENTS.length >= 30);
  const groups = new Set(ACHIEVEMENT_GROUPS.map((g) => g.id));
  for (const a of ACHIEVEMENTS) {
    assert.ok(groups.has(a.group), a.id);
    assert.doesNotMatch(`${a.title} ${a.description}`, /los[et]|lighter|under your|deficit|skip|\bfast(ing)?\b|slim|thin|kg|lb|calorie/i, a.id);
  }
});

test('an empty diary earns nothing', () => {
  assert.equal(earned([]).size, 0);
});

test('total days are counted however spread out, so missing days does not cost them', () => {
  // Every fourth day: ten days logged, never two in a row.
  const meals = Array.from({ length: 10 }, (_, i) => meal(addDays('2026-06-01', i * 4)));
  const got = earned(meals);
  assert.ok(got.has('days-10'));
  assert.ok(!got.has('streak-3'), 'three-day gaps break a streak');
  assert.ok(got.has('welcome-back') === false, 'a three-day gap is not "away"');
});

test('welcome back needs a week or more away, then a meal', () => {
  assert.ok(!earned([meal('2026-09-01'), meal('2026-09-08')]).has('welcome-back'), 'six days missed');
  assert.ok(earned([meal('2026-09-01'), meal('2026-09-09')]).has('welcome-back'), 'seven days missed');
});

test('streaks come from the best run, so a restored diary keeps what it earned', () => {
  const got = earned(run('2026-01-01', 55));
  for (const id of ['streak-3', 'streak-7', 'streak-14', 'streak-30', 'streak-50', 'days-50']) assert.ok(got.has(id), id);
  assert.ok(!got.has('streak-100'));
});

test('protein week: five days hitting protein inside one Monday-to-Sunday week', () => {
  const big = { nutrients: { calories: 900, protein: 110, carbs: 60, fat: 20, fibre: 5 } };
  // Mon 14 Sep to Fri 18 Sep 2026.
  assert.ok(earned(run('2026-09-14', 5, big)).has('protein-week'));
  // Thu 17 Sep to Mon 21 Sep: five days, but across two weeks.
  const split = earned(run('2026-09-17', 5, big));
  assert.ok(split.has('protein-hit') && !split.has('protein-week'));
});

test('fibre fan counts thirty fibre days, in a row or not', () => {
  const fibre = { nutrients: { calories: 700, protein: 20, carbs: 90, fat: 15, fibre: 32 } };
  const meals = Array.from({ length: 30 }, (_, i) => meal(addDays('2026-03-01', i * 2), fibre));
  assert.ok(earned(meals).has('fibre-30'));
  assert.ok(!earned(meals.slice(1)).has('fibre-30'));
});

test('balanced days are finished days: today does not count yet', () => {
  const good = { score: 85 };
  assert.ok(!earned([meal(TODAY, good)]).has('balanced-day'));
  const three = earned(run(addDays(TODAY, -3), 3, good));
  assert.ok(three.has('balanced-day') && three.has('balanced-3'));
  const gap = [meal('2026-09-01', good), meal('2026-09-02', good), meal('2026-09-04', good)];
  assert.ok(!earned(gap).has('balanced-3'));
});

test('water: one day for well watered, seven running for the habit', () => {
  const days = Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => addDays('2026-09-01', i)).map((date) => [date, { date, water: 8, steps: 0 }]),
  );
  const got = earned([], days);
  assert.ok(got.has('hydrated') && got.has('water-week'));
  delete days['2026-09-04'];
  assert.ok(!earned([], days).has('water-week'));
});

test('weighing in four weeks running rewards the checking, whatever the number', () => {
  const weigh = (date: string, weightKg: number) => [date, { date, water: 0, steps: 0, weightKg }];
  const up = Object.fromEntries([weigh('2026-08-31', 80), weigh('2026-09-08', 81), weigh('2026-09-16', 82), weigh('2026-09-22', 83)]);
  assert.ok(earned([], up).has('weigh-4'), 'weight going up still counts');
  const gap = Object.fromEntries([weigh('2026-08-31', 80), weigh('2026-09-08', 80), weigh('2026-09-22', 80)]);
  assert.ok(!earned([], gap).has('weigh-4'));
});

test('variety: different foods, and a full day of meals', () => {
  const meals = Array.from({ length: 25 }, (_, i) => meal(addDays('2026-05-01', i)));
  assert.ok(earned(meals).has('foods-25'));
  const same = meals.map((m) => ({ ...m, items: m.items.map((it) => ({ ...it, name: '  Toast ' })) }));
  assert.ok(!earned(same).has('foods-25'), 'the same food twenty-five times');
  const day = (['breakfast', 'lunch', 'dinner'] as MealSlot[]).map((slot) => meal('2026-09-10', { slot }));
  assert.ok(earned(day).has('full-day'));
  assert.ok(!earned(day.slice(0, 2)).has('full-day'));
});

test('meals dated in the future earn nothing yet', () => {
  assert.equal(earned([meal(addDays(TODAY, 3))]).size, 0);
});

test('the new middle-distance badges carry something to use, and say so', async () => {
  const { rewardsFor, unlocksLine } = await import('../src/lib/rewards');
  assert.deepEqual(rewardsFor('welcome-back'), ['the Beach day scene']);
  assert.deepEqual(rewardsFor('days-50'), ['Headphones']);
  assert.equal(unlocksLine('days-50'), 'Unlocks Headphones');
  assert.match(unlocksLine('first-meal'), /^Unlocks .+ and \d+ more$/, 'a long list is cut short');
  assert.equal(unlocksLine('first-question'), '');
});
