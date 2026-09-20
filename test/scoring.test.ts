import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNSCORED, qualityScore, scoreLabel } from '../src/lib/nutrition';
import { dayScore } from '../src/lib/selectors';
import type { MealEntry, Nutrients, Targets } from '../src/types';

// Roomy enough that nothing in here trips the over-target penalty — these
// cases are about the composition half of the score.
const TARGETS: Targets = {
  calories: 2000, protein: 120, carbs: 200, fat: 65, fibre: 28,
  sugar: 50, sodium: 2300, water: 8, steps: 8000,
};

const DAY = '2026-09-20';
const nutrients = (calories: number, over: Partial<Nutrients> = {}): Nutrients => ({
  calories, protein: 30, carbs: 40, fat: 15, fibre: 6, sugar: 8, sodium: 400, ...over,
});
const meal = (id: string, calories: number, score: number): MealEntry =>
  ({ id, date: DAY, time: '12:00', slot: 'lunch', title: id, items: [], score, source: 'search', nutrients: nutrients(calories) } as MealEntry);

test('water is not a bad meal — it is not a meal to judge at all', () => {
  const water = nutrients(0, { protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0, sodium: 0 });
  assert.equal(qualityScore(water), UNSCORED);

  const verdict = scoreLabel(qualityScore(water));
  assert.equal(verdict.tone, 'none', 'it used to come out as the worst tone there is');
  assert.notEqual(verdict.label, 'Heavy');
});

test('the labels still work for food that does have calories', () => {
  assert.equal(scoreLabel(90).label, 'Brilliant');
  assert.equal(scoreLabel(60).label, 'Balanced');
  assert.equal(scoreLabel(45).label, 'So-so');
  assert.equal(scoreLabel(20).label, 'Heavy');
  assert.equal(scoreLabel(1).label, 'Heavy', 'one out of a hundred is a real score, and a poor one');
});

test('logging a glass of water does not cost you points on a good day', () => {
  const lunch = meal('lunch', 700, 80);
  const water = meal('water', 0, UNSCORED);

  assert.equal(dayScore([lunch], DAY, TARGETS), 80);
  assert.equal(dayScore([lunch, water], DAY, TARGETS), 80, 'the water used to drag this down to 74');
});

test('a day of nothing but water is unscored rather than nought out of a hundred', () => {
  assert.equal(dayScore([meal('water', 0, UNSCORED)], DAY, TARGETS), UNSCORED);
});

test('an empty day is still unscored', () => {
  assert.equal(dayScore([], DAY, TARGETS), UNSCORED);
});

test('a big meal still moves the day more than a small one', () => {
  const big = meal('dinner', 900, 40);
  const small = meal('apple', 90, 90);
  const score = dayScore([big, small], DAY, TARGETS);
  assert.ok(score < 55, `the dinner should dominate, got ${score}`);
});
