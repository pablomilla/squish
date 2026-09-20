import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PENALTY,
  OVER,
  WAY_OVER,
  dayVerdict,
  isCeiling,
  overPenalty,
  overPhrase,
  overTargets,
  scoreLabel,
} from '../src/lib/nutrition';
import { dayScore } from '../src/lib/selectors';
import type { MealEntry, Nutrients, Targets } from '../src/types';

const TARGETS: Targets = {
  calories: 2000, protein: 120, carbs: 200, fat: 65, fibre: 28,
  sugar: 50, sodium: 2300, water: 8, steps: 8000,
};

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
  const totals = day({ fat: Math.round(65 * 1.3) });
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
  const justUnder = overTargets(day({ fat: 65 * OVER - 0.01 }), TARGETS);
  assert.deepEqual(justUnder, [], 'under a quarter over says nothing');

  const at = overTargets(day({ fat: 65 * OVER }), TARGETS);
  assert.equal(at[0].level, 'over');

  const loud = overTargets(day({ fat: 65 * WAY_OVER }), TARGETS);
  assert.equal(loud[0].level, 'way-over');
});

test('a target of nought is not something to be over', () => {
  const noLimits = { ...TARGETS, sugar: 0, sodium: 0 };
  assert.deepEqual(overTargets(day({ sugar: 200, sodium: 9000 }), noLimits), []);
});

test('how far over, in words', () => {
  const at = (ratio: number) => overPhrase({ key: 'fat', value: 65 * ratio, target: 65, ratio, level: 'over' });

  assert.equal(at(1.3), '30% over');
  assert.equal(at(190 / 65), 'nearly 3×', 'the reported day, rounded the way a person would say it');
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
  assert.ok(penalty(1.3) <= 2, `a whisker over should barely register, got ${penalty(1.3)}`);
  assert.ok(penalty(WAY_OVER) > penalty(1.45), 'and it climbs smoothly through the loud threshold');
  assert.ok(penalty(2) > penalty(1.5), 'twice over costs more than half again over');
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
