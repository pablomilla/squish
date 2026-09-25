import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainDay, EARLY_KCAL } from '../src/lib/dayExplained';
import { mealLabel, qualityScore, scoreBreakdown, scoreLabel, SCORE_BASE } from '../src/lib/nutrition';
import { dayScore } from '../src/lib/selectors';
import { computeTargets } from '../src/lib/nutrition';
import type { MealEntry, Nutrients } from '../src/types';

/** The day score explained: what it is, when it is too early, and what moved it. */

const targets = computeTargets({ name: 'P', sex: 'male', age: 40, heightCm: 178, weightKg: 82, targetWeightKg: 76, activity: 'light', goal: 'lose', pace: 0.5, units: 'metric', onboarded: true } as never);
const TODAY = '2026-09-25';

// A Special K dark chocolate bar, about 22 g, from its label.
const bar: Nutrients = { calories: 89, protein: 1.3, carbs: 15, fat: 2.4, fibre: 1.1, sugar: 6.8, sodium: 50, satFat: 1.4, freeSugar: 6.8 } as Nutrients;
const dinner: Nutrients = { calories: 620, protein: 45, carbs: 55, fat: 18, fibre: 11, sugar: 7, sodium: 700, satFat: 4, freeSugar: 1 } as Nutrients;

const meal = (date: string, nutrients: Nutrients, upf = false): MealEntry =>
  ({
    id: `${date}-${nutrients.calories}`,
    date,
    time: '12:00',
    slot: 'snack',
    title: 'x',
    items: [{ id: '1', name: 'x', nutrients, ultraProcessed: upf }],
    nutrients,
    score: qualityScore(nutrients, upf ? 1 : 0),
    source: 'manual',
  }) as unknown as MealEntry;

test('the breakdown adds up to the score, exactly — the explanation cannot disagree with the number', () => {
  for (const [n, upf] of [[bar, 1], [bar, 0], [dinner, 0]] as const) {
    const { base, factors, score } = scoreBreakdown(n, upf);
    assert.equal(base, SCORE_BASE);
    assert.equal(score, Math.max(1, Math.min(100, Math.round(Object.values(factors).reduce((a, b) => a + b, base)))));
    assert.equal(score, qualityScore(n, upf));
  }
});

test('the lowest band is "Room to improve", never "Heavy", and reads right about a meal', () => {
  assert.equal(scoreLabel(30).label, 'Room to improve');
  assert.equal(mealLabel(30), 'Room to improve');
  assert.equal(mealLabel(60), 'Balanced meal');
  assert.equal(mealLabel(0), 'Nothing to score');
});

test('one chocolate bar this morning is "early days", not a verdict on the day', () => {
  const day = explainDay([meal(TODAY, bar, true)], TODAY, targets, TODAY);
  assert.equal(day.early, true);
  assert.ok(day.calories < EARLY_KCAL);
  assert.ok(day.score > 0, 'the number is still there to see');
  // What moved it: added sugar and processing down, nothing much up.
  const keys = day.reasons.map((r) => r.key);
  assert.ok(keys.includes('freeSugar') && keys.includes('processed'), JSON.stringify(day.reasons));
  assert.ok(day.reasons.every((r, i, all) => i === 0 || Math.abs(all[i - 1].points) >= Math.abs(r.points)), 'biggest first');
  assert.match(day.tip ?? '', /sweet/, 'the tip is about what brought it down most');
});

test('the same bar on a past day is scored, not early: that day is finished', () => {
  assert.equal(explainDay([meal('2026-09-20', bar, true)], '2026-09-20', targets, TODAY).early, false);
});

test('a proper day is not early, is weighted by calories like the score, and a good one gets no nagging tip', () => {
  const meals = [meal(TODAY, bar, true), meal(TODAY, dinner)];
  const day = explainDay(meals, TODAY, targets, TODAY);
  assert.equal(day.early, false);
  assert.equal(day.score, dayScore(meals, TODAY, targets));
  assert.equal(day.reasons[0].key, 'protein', 'dinner outweighs the bar');
  const good = explainDay([meal(TODAY, dinner)], TODAY, targets, TODAY);
  assert.ok(good.score >= 55);
  assert.equal(good.tip, null);
});

test('nothing logged explains nothing', () => {
  const day = explainDay([], TODAY, targets, TODAY);
  assert.deepEqual([day.score, day.reasons, day.tip], [0, [], null]);
});

test('a meal explains itself with the factors its score is built from', async () => {
  const { explainMeal } = await import('../src/lib/dayExplained');
  const pizza: Nutrients = { calories: 820, protein: 34, carbs: 88, fat: 36, fibre: 5, sugar: 10, sodium: 1900, satFat: 16, freeSugar: 4 } as Nutrients;
  const explained = explainMeal(pizza, [{ id: '1', name: 'Pizza', nutrients: pizza, ultraProcessed: true }] as never);
  assert.equal(explained.score, qualityScore(pizza, 1));
  assert.deepEqual(explained.reasons.map((r) => r.key), ['protein', 'processed', 'salt', 'fibre', 'satFat']);
  assert.equal(explained.small, false);
  assert.equal(explainMeal(bar, []).small, true, 'a small snack is judged gently, and says so');
});
