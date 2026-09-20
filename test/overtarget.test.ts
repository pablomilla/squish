import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PENALTY,
  OVER,
  ceilingLimit,
  computeTargets,
  WAY_OVER,
  dayVerdict,
  isCeiling,
  overPenalty,
  overPhrase,
  overTargets,
  scoreLabel,
} from '../src/lib/nutrition';
import { dayScore, series, summarise } from '../src/lib/selectors';
import { raiseFatTarget } from '../src/store/useSquish';
import type { MealEntry, Nutrients, Targets } from '../src/types';

const TARGETS: Targets = {
  calories: 2000, protein: 120, carbs: 200, fat: 67, fibre: 28,
  sugar: 50, sodium: 2300, water: 8, steps: 8000,
  // 35% and 65% of 2,000 kcal. The aim is 67 g of fat; 78 g is where the
  // guidance says too much starts, and that is what "over" is measured from.
  fatMax: 78, carbsMax: 325,
};
const FAT_LIMIT = TARGETS.fatMax as number;

const day = (over: Partial<Nutrients> = {}): Nutrients => ({
  calories: 2000, protein: 110, carbs: 180, fat: 60, fibre: 25, sugar: 40, sodium: 1800, ...over,
});

test('the day the user reported: 190 g of fat against 65 g is not a balanced day', () => {
  const totals = day({ fat: 190 });
  const score = 62; // What the composition score says, and used to be the whole story.

  assert.equal(scoreLabel(score).label, 'Balanced', 'the score itself has not moved');

  const verdict = dayVerdict(score, totals, TARGETS);
  assert.equal(verdict.label, 'Over on fat');
  assert.equal(verdict.tone, 'bad');
  assert.equal(verdict.over[0].key, 'fat');
});

test('a day inside its targets reads exactly as it did before', () => {
  const verdict = dayVerdict(62, day(), TARGETS);
  assert.equal(verdict.label, 'Balanced');
  assert.equal(verdict.tone, 'good');
  assert.deepEqual(verdict.over, []);
});

test('nothing logged still says nothing logged, targets or no targets', () => {
  const verdict = dayVerdict(0, day({ fat: 190 }), TARGETS);
  assert.equal(verdict.tone, 'none');
});

test('a quarter over is flagged but does not overrule the score', () => {
  const totals = day({ fat: Math.round(FAT_LIMIT * 1.3) });
  const verdict = dayVerdict(80, totals, TARGETS);

  assert.equal(verdict.label, 'Brilliant', 'a little over is worth showing, not worth shouting');
  assert.equal(verdict.over.length, 1);
  assert.equal(verdict.over[0].level, 'over');
});

test('only the ceilings count — eating plenty of protein is not a warning', () => {
  assert.deepEqual(overTargets(day({ protein: 300, fibre: 90 }), TARGETS), []);
  assert.equal(isCeiling('fat'), true);
  assert.equal(isCeiling('carbs'), true);
  assert.equal(isCeiling('protein'), false);
  assert.equal(isCeiling('fibre'), false);
});

test('sugar and salt are ceilings too', () => {
  const salty = overTargets(day({ sodium: 6000 }), TARGETS);
  assert.equal(salty[0].key, 'sodium');

  const sweet = overTargets(day({ sugar: 160 }), TARGETS);
  assert.equal(sweet[0].key, 'sugar');
  assert.equal(dayVerdict(70, day({ sugar: 160 }), TARGETS).label, 'Over on sugar');
});

test('the worst offender is the one named', () => {
  const totals = day({ fat: 100, sugar: 200 }); // 1.5x fat, 4x sugar.
  const flags = overTargets(totals, TARGETS);

  assert.equal(flags.length, 2);
  assert.equal(flags[0].key, 'sugar', 'sorted worst first');
  assert.equal(dayVerdict(50, totals, TARGETS).label, 'Over on sugar');
});

test('the thresholds are where they say they are', () => {
  const justUnder = overTargets(day({ fat: FAT_LIMIT * OVER - 0.01 }), TARGETS);
  assert.deepEqual(justUnder, [], 'under a quarter over the limit says nothing');

  const at = overTargets(day({ fat: FAT_LIMIT * OVER }), TARGETS);
  assert.equal(at[0].level, 'over');

  const loud = overTargets(day({ fat: FAT_LIMIT * WAY_OVER }), TARGETS);
  assert.equal(loud[0].level, 'way-over');
});

test('a target of nought is not something to be over', () => {
  // Zeroing sugar on the You screen means "stop counting it" — a limit worked
  // out from the calorie target must not quietly put it back.
  const noLimits = { ...TARGETS, sugar: 0, sugarMax: undefined, sodium: 0 };
  assert.equal(ceilingLimit('sugar', noLimits), 0);
  assert.deepEqual(overTargets(day({ sugar: 200, sodium: 9000 }), noLimits), []);
});

test('how far over, in words', () => {
  const at = (ratio: number) => overPhrase({ key: 'fat', value: 65 * ratio, target: 65, ratio, level: 'over' });

  assert.equal(at(1.3), '30% over');
  assert.equal(at(2.92), 'nearly 3×', 'rounded the way a person would say it');
  assert.equal(at(2), '2×');
  assert.equal(at(3.4), 'over 3×');
});


/* ------------------------------------------------------------------ *
 * The score itself, not just the words beside it.
 * ------------------------------------------------------------------ */

const DAY = '2026-09-20';
const meal = (id: string, score: number, n: Nutrients): MealEntry =>
  ({ id, date: DAY, time: '12:00', slot: 'lunch', title: id, items: [], score, source: 'search', nutrients: n } as MealEntry);

const penalty = (ratio: number) => overPenalty([{ key: 'fat', value: 65 * ratio, target: 65, ratio, level: ratio >= WAY_OVER ? 'way-over' : 'over' }]);

test('the penalty ramps from the first flag — no cliff at half over', () => {
  assert.equal(penalty(OVER), 0, 'the moment it is worth mentioning it still costs nothing');
  assert.ok(penalty(1.1) <= 2, `a whisker past the limit should barely register, got ${penalty(1.1)}`);
  assert.ok(penalty(1.3) > penalty(1.1), 'and grows with how far past it you went');
  assert.ok(penalty(WAY_OVER) > penalty(1.45), 'climbing smoothly through the loud threshold');
  assert.ok(penalty(2) > penalty(1.5), 'twice the limit costs more than half again over');
});

test('no single nutrient can take more than thirty points', () => {
  assert.equal(penalty(10), 30);
  assert.equal(penalty(100), 30);
});

test('a day of everything at once still lands on its feet', () => {
  const everything = overTargets(day({ carbs: 800, fat: 400, sugar: 400, sodium: 12000 }), TARGETS);
  assert.equal(everything.length, 4);
  assert.equal(overPenalty(everything), MAX_PENALTY);
});

test("the reported day: well-scoring meals, a day that isn't", () => {
  // Three sensible-looking meals. Every one of them scores respectably on its
  // own; together they put 190 g of fat against a 65 g target.
  const meals = [
    meal('a', 62, { calories: 700, protein: 35, carbs: 60, fat: 62, fibre: 8, sugar: 12, sodium: 600 }),
    meal('b', 62, { calories: 700, protein: 35, carbs: 60, fat: 62, fibre: 8, sugar: 12, sodium: 600 }),
    meal('c', 62, { calories: 700, protein: 35, carbs: 60, fat: 66, fibre: 8, sugar: 14, sodium: 600 }),
  ];

  const score = dayScore(meals, DAY, TARGETS);
  assert.equal(scoreLabel(62).label, 'Balanced', 'what it used to come out as');
  assert.ok(score <= 38, `the day should no longer read as balanced, got ${score}`);
  assert.equal(dayVerdict(score, { calories: 2100, protein: 105, carbs: 180, fat: 190, fibre: 24, sugar: 38, sodium: 1800 }, TARGETS).label, 'Over on fat');
});

test('a day inside its targets scores exactly what it always did', () => {
  const meals = [
    meal('a', 80, { calories: 900, protein: 55, carbs: 90, fat: 28, fibre: 12, sugar: 18, sodium: 700 }),
    meal('b', 70, { calories: 900, protein: 55, carbs: 90, fat: 30, fibre: 12, sugar: 18, sodium: 700 }),
  ];
  assert.equal(dayScore(meals, DAY, TARGETS), 75, 'the plain weighted average, untouched');
});

test('the penalty can never take a day down to "nothing to score"', () => {
  const meals = [meal('a', 1, { calories: 3000, protein: 20, carbs: 900, fat: 400, fibre: 2, sugar: 500, sodium: 15000 })];
  const score = dayScore(meals, DAY, TARGETS);
  assert.equal(score, 1, 'nought is the word for an empty day, not a terrible one');
  assert.notEqual(dayVerdict(score, meals[0].nutrients, TARGETS).tone, 'none');
});

test('eating plenty of protein and fibre costs nothing', () => {
  const meals = [meal('a', 90, { calories: 1800, protein: 300, carbs: 150, fat: 50, fibre: 90, sugar: 20, sodium: 1200 })];
  assert.equal(dayScore(meals, DAY, TARGETS), 90);
});

test('the insights series carries sugar, and salt rather than sodium', () => {
  const meals = [meal('a', 70, { calories: 900, protein: 40, carbs: 90, fat: 30, fibre: 10, sugar: 26, sodium: 1200 })];
  const point = series(meals, [DAY], TARGETS)[0];

  assert.equal(point.sugar, 26);
  assert.equal(point.salt, 3, '1200 mg of sodium is 3 g of salt — what the packet says');
});

test('range averages cover only the days that were logged', () => {
  const dates = [DAY, '2026-09-21', '2026-09-22'];
  const meals = [
    meal('a', 70, { calories: 900, protein: 40, carbs: 90, fat: 30, fibre: 10, sugar: 20, sodium: 1000 }),
    { ...meal('b', 70, { calories: 900, protein: 40, carbs: 90, fat: 30, fibre: 10, sugar: 40, sodium: 2000 }), date: '2026-09-22' },
  ];
  const summary = summarise(series(meals, dates, TARGETS), TARGETS);

  assert.equal(summary.loggedDays, 2, 'the blank day in the middle sits it out');
  assert.equal(summary.avgSugar, 30);
  assert.equal(summary.avgSalt, 3.8, 'kept to a decimal — 3.8 g and 4 g are not the same advice');
});

/* ------------------------------------------------------------------ *
 * Fat: an aim of 30% of energy, a limit of 35%.
 * ------------------------------------------------------------------ */

test('the fat target is 30% of energy, not 28%', () => {
  const t = computeTargets({
    name: '', sex: 'female', age: 29, heightCm: 168, weightKg: 67, targetWeightKg: 63,
    activity: 'light', goal: 'lose', pace: 0.5, units: 'metric', onboarded: true,
  });

  const share = (t.fat * 9) / t.calories;
  assert.ok(Math.abs(share - 0.3) < 0.01, `fat should be about 30% of energy, got ${Math.round(share * 100)}%`);
  assert.ok(t.protein * 4 + t.fat * 9 + t.carbs * 4 <= t.calories * 1.02, 'and the macros still add up to the day');
});

test('nothing is flagged between the aim and the limit', () => {
  const t: Targets = { ...TARGETS, calories: 2000, fat: 67, fatMax: 78 };

  // 33% of energy from fat: above the target, comfortably inside the range
  // every guideline gives. This was being marked down.
  assert.deepEqual(overTargets(day({ fat: 73 }), t), [], '73 g against a 78 g limit is not over');
  assert.equal(ceilingLimit('fat', t), 78);

  const over = overTargets(day({ fat: 100 }), t);
  assert.equal(over.length, 1, 'past the limit it still speaks up');
  assert.equal(over[0].target, 78, 'and measures from the limit, not the aim');
});

test('a Mediterranean day of olive oil, nuts and salmon is not a bad day', () => {
  // The PREDIMED intervention: 4 tbsp of olive oil (54 g fat) and 30 g of mixed
  // nuts (18 g), on top of everything else. Add a salmon fillet and it is 85 g.
  const t: Targets = { ...TARGETS, calories: 2200, fat: 73, fatMax: 86, sodium: 2300, sugar: 55 };
  const mediterranean = {
    calories: 2150, protein: 105, carbs: 170, fat: 85, fibre: 34, sugar: 30, sodium: 1500,
  };

  assert.deepEqual(overTargets(mediterranean, t), [], 'the trial arm that cut cardiovascular events by a third');
  assert.equal(overPenalty(overTargets(mediterranean, t)), 0, 'and it costs the day nothing');
});

test('a store written before the change has its fat target raised', () => {
  // What the old formula wrote: fat at 28% of energy, carbohydrate the rest.
  const oldFat = Math.round((2000 * 0.28) / 9);
  const before = {
    targets: {
      ...TARGETS, calories: 2000, protein: 120, fat: oldFat,
      carbs: Math.round((2000 - 120 * 4 - oldFat * 9) / 4),
      fatMax: undefined, carbsMax: undefined,
    },
  };
  const after = (raiseFatTarget(before, 1) as { targets: Targets }).targets;

  assert.equal(oldFat, 62);
  assert.equal(after.fat, 67);
  assert.equal(after.fatMax, 78);
  assert.ok(after.carbs < before.targets.carbs, 'carbohydrate is the remainder, so it gives way');
});

test('a fat target somebody set themselves is left alone', () => {
  const mine = { targets: { ...TARGETS, calories: 2000, protein: 120, fat: 95 } };
  assert.equal((raiseFatTarget(mine, 1) as { targets: Targets }).targets.fat, 95);
  assert.equal((raiseFatTarget(mine, 2) as { targets: Targets }).targets.fat, 95, 'and it does not run twice');
});
