import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PENALTY,
  OVER,
  addNutrients,
  ceilingLimit,
  computeTargets,
  qualityScore,
  WAY_OVER,
  dayVerdict,
  isCeiling,
  overPenalty,
  overPhrase,
  overTargets,
  scoreLabel,
} from '../src/lib/nutrition';
import { dayScore, series, summarise } from '../src/lib/selectors';
import { FOODS } from '../src/lib/foods';
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

/* ------------------------------------------------------------------ *
 * Saturated fat: the distinction the whole argument turns on.
 * ------------------------------------------------------------------ */

test('unsaturated fat no longer marks a meal down the way saturated does', () => {
  const kcal = 400;
  const olive = { calories: kcal, protein: 8, carbs: 20, fat: 30, fibre: 6, satFat: 4.5, sugar: 5, sodium: 300 };
  const butter = { ...olive, satFat: 20 };

  // The saturates penalty tops out at 18 points, so that is the widest the gap
  // between two otherwise identical plates can be — a full grade.
  assert.ok(qualityScore(olive) > qualityScore(butter) + 15,
    `same fat, different kind: ${qualityScore(olive)} vs ${qualityScore(butter)}`);
  assert.equal(scoreLabel(qualityScore(olive)).label, 'Balanced');
  assert.equal(scoreLabel(qualityScore(butter)).label, 'So-so');
});

test('the foods the evidence likes score better than they used to', () => {
  // Per the app's own food table, scaled to 1000 kcal for comparison.
  const salmon = { calories: 208, protein: 20, carbs: 0, fat: 13, fibre: 0, satFat: 3.1, sugar: 0, sodium: 59 };
  const almonds = { calories: 579, protein: 21, carbs: 22, fat: 50, fibre: 12.5, satFat: 3.8, sugar: 4.4, sodium: 1 };

  const before = (n: Nutrients) => qualityScore({ ...n, satFat: undefined });
  assert.ok(qualityScore(salmon) > before(salmon), `salmon ${before(salmon)} -> ${qualityScore(salmon)}`);
  assert.ok(qualityScore(almonds) > before(almonds), `almonds ${before(almonds)} -> ${qualityScore(almonds)}`);
  assert.ok(qualityScore(almonds) >= 75, 'a handful of almonds is a good snack, and should read like one');
});

test('butter and cream still get what they had coming', () => {
  const butter = { calories: 717, protein: 0.9, carbs: 0.1, fat: 81, fibre: 0, satFat: 51, sugar: 0.1, sodium: 643 };
  assert.ok(qualityScore(butter) < 38, `got ${qualityScore(butter)}`);
});

test('a meal logged before Squish asked for saturates is judged the old way', () => {
  const old = { calories: 500, protein: 20, carbs: 40, fat: 30, fibre: 5, sugar: 8, sodium: 400 };
  assert.equal(qualityScore(old), qualityScore({ ...old, satFat: undefined }));
  assert.notEqual(qualityScore(old), qualityScore({ ...old, satFat: 0 }), 'unknown is not the same answer as none');
});

test('a day of unknowns does not add up to a day of none', () => {
  const unknown = { calories: 500, protein: 20, carbs: 40, fat: 20, fibre: 5, sugar: 8, sodium: 400 };
  const known = { ...unknown, satFat: 6 };

  assert.equal(addNutrients(unknown, unknown).satFat, undefined);
  assert.equal(addNutrients(unknown, known).satFat, 6, 'what is known still counts');
  assert.equal(addNutrients(known, known).satFat, 12);
});

test('no saturates figure means nothing to be over', () => {
  const t: Targets = { ...TARGETS, satFat: 22 };
  assert.deepEqual(overTargets({ ...day(), satFat: undefined }, t), []);

  const over = overTargets({ ...day(), satFat: 60 }, t);
  assert.equal(over[0].key, 'satFat');
  assert.equal(dayVerdict(70, { ...day(), satFat: 60 }, t).label, 'Over on saturates');
});

test('the saturates limit is 10% of energy', () => {
  const t = computeTargets({
    name: '', sex: 'male', age: 40, heightCm: 178, weightKg: 88, targetWeightKg: 80,
    activity: 'moderate', goal: 'maintain', pace: 0, units: 'metric', onboarded: true,
  });
  const share = ((t.satFat ?? 0) * 9) / t.calories;
  assert.ok(Math.abs(share - 0.1) < 0.01, `got ${Math.round(share * 100)}%`);
  assert.ok((t.satFat ?? 0) < t.fat, 'and it is a slice of the fat, not on top of it');
});

test('every food in the table has a believable saturates figure', () => {
  for (const food of FOODS) {
    const { satFat, fat, name } = { ...food.per100, name: food.name };
    assert.notEqual(satFat, undefined, `${name} has no saturates figure`);
    assert.ok((satFat as number) <= fat + 0.001, `${name}: ${satFat} g saturates inside ${fat} g of fat`);
    assert.ok((satFat as number) >= 0, `${name}: negative saturates`);
  }
});

/* ------------------------------------------------------------------ *
 * Free sugars: the figure the 10% was always about.
 * ------------------------------------------------------------------ */

test('an apple is not charged for being an apple', () => {
  const apple = { calories: 95, protein: 0.5, carbs: 25, fat: 0.2, fibre: 4.4, satFat: 0, sugar: 19, freeSugar: 0, sodium: 2 };
  const sweets = { ...apple, freeSugar: 19 };

  assert.ok(qualityScore(apple) > qualityScore(sweets) + 15,
    `same sugar, different kind: ${qualityScore(apple)} vs ${qualityScore(sweets)}`);
  assert.ok(qualityScore(apple) >= 70, `an apple should read well, got ${qualityScore(apple)}`);
});

test('milk is not charged for its lactose', () => {
  const milk = { calories: 125, protein: 8.5, carbs: 12, fat: 4.5, fibre: 0, satFat: 2.8, sugar: 12, freeSugar: 0, sodium: 110 };
  assert.ok(qualityScore(milk) > qualityScore({ ...milk, freeSugar: undefined }) + 10,
    'the old total-sugar rule docked a glass of milk the full twenty');
});

test('juice counts as free sugar, because the guideline says so', () => {
  const juice = { calories: 112, protein: 1.8, carbs: 26, fat: 0.5, fibre: 0.5, satFat: 0, sugar: 21, freeSugar: 21, sodium: 2 };
  const whole = { ...juice, freeSugar: 0 };
  assert.ok(qualityScore(juice) < qualityScore(whole) - 15, 'liquidised fruit is not the same as fruit');
});

test('sweets are still sweets', () => {
  const cola = { calories: 139, protein: 0, carbs: 35, fat: 0, fibre: 0, satFat: 0, sugar: 35, freeSugar: 35, sodium: 13 };
  assert.ok(qualityScore(cola) < 38, `got ${qualityScore(cola)}`);
});

test('no free-sugar figure falls back to the old rule rather than to nought', () => {
  const unknown = { calories: 400, protein: 10, carbs: 70, fat: 8, fibre: 3, satFat: 3, sugar: 40, sodium: 200 };
  assert.equal(qualityScore(unknown), qualityScore({ ...unknown, freeSugar: undefined }));
  assert.notEqual(qualityScore(unknown), qualityScore({ ...unknown, freeSugar: 0 }),
    'unknown must not be read as "none of it is free"');
  assert.equal(addNutrients(unknown, unknown).freeSugar, undefined);
});

test('the free-sugar limit is 10% of energy, and sits inside the total', () => {
  const t = computeTargets({
    name: '', sex: 'female', age: 30, heightCm: 168, weightKg: 68, targetWeightKg: 63,
    activity: 'light', goal: 'maintain', pace: 0, units: 'metric', onboarded: true,
  });
  const share = ((t.freeSugar ?? 0) * 4) / t.calories;
  assert.ok(Math.abs(share - 0.1) < 0.01, `got ${Math.round(share * 100)}%`);
  assert.ok((t.freeSugar ?? 0) <= ceilingLimit('sugar', t), 'free sugars cannot exceed the total-sugar limit');
});

test('going over on free sugars is flagged by its own name', () => {
  const t: Targets = { ...TARGETS, freeSugar: 50 };
  assert.deepEqual(overTargets({ ...day(), freeSugar: undefined }, t), []);
  assert.equal(dayVerdict(70, { ...day(), freeSugar: 120 }, t).label, 'Over on free sugars');
});

test('every food in the table has a believable free-sugar figure', () => {
  for (const food of FOODS) {
    const { freeSugar, sugar, name } = { ...food.per100, name: food.name };
    assert.notEqual(freeSugar, undefined, `${name} has no free-sugar figure`);
    assert.ok((freeSugar as number) <= (sugar ?? 0) + 0.001, `${name}: ${freeSugar} g free inside ${sugar} g total`);
    assert.ok((freeSugar as number) >= 0, `${name}: negative free sugar`);
  }
});
