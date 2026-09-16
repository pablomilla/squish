import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeTargets, macroSplit, qualityScore, scaleNutrients, sumNutrients, tdee } from '../src/lib/nutrition';
import { estimateFromText } from '../src/lib/estimate';
import { searchFoods, toFoodItem } from '../src/lib/foods';
import { dayScore, moodFor, streakOf, summarise, series } from '../src/lib/selectors';
import { addDays, isoDate, lastDays, weekOf } from '../src/lib/date';
import type { MealEntry, Profile } from '../src/types';

const profile: Profile = {
  name: 'Test',
  sex: 'female',
  age: 30,
  heightCm: 168,
  weightKg: 68,
  targetWeightKg: 63,
  activity: 'light',
  goal: 'lose',
  pace: 0.5,
  units: 'metric',
  onboarded: true,
};

test('targets sit below maintenance when losing and above when gaining', () => {
  const losing = computeTargets(profile);
  const gaining = computeTargets({ ...profile, goal: 'gain' });
  const steady = computeTargets({ ...profile, goal: 'maintain' });
  assert.ok(losing.calories < steady.calories);
  assert.ok(gaining.calories > steady.calories);
  assert.ok(Math.abs(steady.calories - tdee(profile)) < 12);
});

test('targets never drop below the safe floor', () => {
  const extreme = computeTargets({ ...profile, weightKg: 45, age: 70, activity: 'sedentary', pace: 1 });
  assert.ok(extreme.calories >= 1200);
});

test('macro targets roughly account for the calorie target', () => {
  const t = computeTargets(profile);
  const fromMacros = t.protein * 4 + t.carbs * 4 + t.fat * 9;
  assert.ok(Math.abs(fromMacros - t.calories) < 30, `${fromMacros} vs ${t.calories}`);
});

test('sums round away floating point noise', () => {
  const total = sumNutrients([
    { nutrients: { calories: 398, protein: 26.4, carbs: 4.8, fat: 28.8, fibre: 0 } },
    { nutrients: { calories: 99, protein: 5.2, carbs: 16.4, fat: 1.4, fibre: 2.8 } },
    { nutrients: { calories: 154, protein: 8.4, carbs: 15.1, fat: 6, fibre: 0 } },
  ]);
  assert.equal(total.calories, 651);
  assert.equal(total.protein, 40);
  assert.equal(total.fibre, 2.8);
});

test('scaling a portion scales every nutrient', () => {
  const scaled = scaleNutrients({ calories: 200, protein: 10, carbs: 20, fat: 5, fibre: 2, sugar: 4, sodium: 100 }, 1.5);
  assert.deepEqual(scaled, { calories: 300, protein: 15, carbs: 30, fat: 7.5, fibre: 3, sugar: 6, sodium: 150 });
});

test('quality score rewards protein and fibre over sugar', () => {
  const wholesome = qualityScore({ calories: 500, protein: 40, carbs: 45, fat: 15, fibre: 12, sugar: 6, sodium: 300 });
  const sugary = qualityScore({ calories: 500, protein: 4, carbs: 80, fat: 18, fibre: 1, sugar: 60, sodium: 700 });
  assert.ok(wholesome > sugary + 20, `${wholesome} vs ${sugary}`);
  assert.ok(wholesome <= 100 && sugary >= 1);
});

test('macro split sums to one and is empty for an empty plate', () => {
  const split = macroSplit({ calories: 500, protein: 30, carbs: 50, fat: 15, fibre: 5 });
  assert.ok(Math.abs(split.protein + split.carbs + split.fat - 1) < 1e-9);
  assert.deepEqual(macroSplit({ calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 }), { protein: 0, carbs: 0, fat: 0 });
});

test('food search prefers the name that covers most of the query', () => {
  assert.equal(searchFoods('diet cola')[0].id, 'diet-cola');
  assert.equal(searchFoods('salmon')[0].id, 'salmon');
  assert.equal(searchFoods('zzzz').length, 0);
});

test('a serving item carries the right nutrition for its weight', () => {
  const banana = toFoodItem(searchFoods('banana')[0]);
  assert.equal(banana.grams, 118);
  assert.equal(banana.nutrients.calories, Math.round((89 * 118) / 100));
});

test('text estimates split a description into separate foods', () => {
  const result = estimateFromText('two scrambled eggs and a slice of wholemeal bread with a diet cola');
  const names = result.items.map((i) => i.name);
  assert.deepEqual(names, ['Scrambled eggs', 'Wholemeal bread', 'Diet cola']);
  assert.equal(result.offline, true);
  assert.ok(result.nutrients.calories > 200 && result.nutrients.calories < 500);
});

test('measurement servings are not multiplied by their own quantity', () => {
  const cola = estimateFromText('a diet cola').items[0];
  assert.equal(cola.portion, '330 ml can');
  assert.ok(cola.nutrients.calories <= 2);
});

test('explicit grams override the default serving', () => {
  const chicken = estimateFromText('150g chicken breast').items[0];
  assert.equal(chicken.portion, '150 g');
  assert.equal(chicken.nutrients.calories, Math.round((165 * 150) / 100));
});

const meal = (date: string, calories: number, score: number): MealEntry => ({
  id: `${date}-${calories}`,
  date,
  time: '12:00',
  slot: 'lunch',
  title: 'Test meal',
  items: [],
  nutrients: { calories, protein: 30, carbs: 40, fat: 12, fibre: 6 },
  score,
  source: 'manual',
});

test('streaks count back from today and survive a missing today', () => {
  const today = isoDate();
  const run = [meal(today, 500, 70), meal(addDays(today, -1), 500, 70), meal(addDays(today, -2), 500, 70)];
  assert.equal(streakOf(run, today), 3);
  assert.equal(streakOf(run.slice(1), today), 2, 'yesterday still counts until the day ends');
  assert.equal(streakOf([meal(addDays(today, -3), 500, 70)], today), 0);
});

test('day score weights big meals more heavily than small ones', () => {
  const today = isoDate();
  const meals = [meal(today, 900, 40), meal(today, 100, 90)];
  const score = dayScore(meals, today);
  assert.ok(score < 55 && score > 40, `${score}`);
  assert.equal(dayScore([], today), 0);
});

test('range summaries only average the days that were logged', () => {
  const today = isoDate();
  const dates = lastDays(7, today);
  const meals = [meal(dates[6], 2000, 80), meal(dates[5], 1000, 60)];
  const summary = summarise(series(meals, dates), computeTargets(profile));
  assert.equal(summary.days, 7);
  assert.equal(summary.loggedDays, 2);
  assert.equal(summary.avgCalories, 1500);
  assert.equal(summary.bestDay?.date, dates[6]);
});

test('the week always runs Monday to Sunday', () => {
  const week = weekOf('2026-09-16'); // a Wednesday
  assert.equal(week.length, 7);
  assert.equal(week[0], '2026-09-14');
  assert.equal(week[6], '2026-09-20');
});

test('mood follows the moment', () => {
  assert.equal(moodFor({ hour: 23, mealsToday: 3, caloriesPct: 1, habits: 4, streak: 5 }), 'sleepy');
  assert.equal(moodFor({ hour: 12, mealsToday: 1, caloriesPct: 0.3, habits: 0, streak: 0, justLogged: true }), 'nomnom');
  assert.equal(moodFor({ hour: 12, mealsToday: 0, caloriesPct: 0, habits: 0, streak: 0 }), 'calm');
  assert.equal(moodFor({ hour: 19, mealsToday: 3, caloriesPct: 1, habits: 4, streak: 2 }), 'cheering');
});
