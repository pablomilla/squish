import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstLogged, monthGrid, monthMarks, searchMeals, stepMonth } from '../src/lib/diaryNav';
import type { MealEntry, Targets } from '../src/types';

/** Getting around a long diary: the month calendar and meal search. */

const meal = (date: string, title: string, items: string[] = [], score = 60, time = '12:00'): MealEntry =>
  ({
    id: `${date}-${title}`,
    date,
    time,
    slot: 'lunch',
    title,
    items: items.map((name, i) => ({ id: String(i), name })),
    nutrients: { calories: 500, protein: 30, carbs: 50, fat: 15, fibre: 8, sugar: 5, sodium: 400 },
    score,
    source: 'manual',
  }) as unknown as MealEntry;

const targets = { calories: 2000, protein: 100, carbs: 250, fat: 70, fibre: 30, sugar: 90, sodium: 2400, water: 2000, steps: 8000 } as unknown as Targets;

test('a month is Monday-first weeks, padded at both ends', () => {
  const september = monthGrid(2026, 8); // Tuesday 1st, 30 days
  assert.equal(september[0][0], null, 'Monday before the 1st');
  assert.equal(september[0][1], '2026-09-01');
  assert.ok(september.every((week) => week.length === 7));
  assert.equal(september.flat().filter(Boolean).length, 30);
  assert.equal(september.at(-1)!.filter(Boolean).at(-1), '2026-09-30');
  const february = monthGrid(2027, 1); // Monday 1st, 28 days: exactly four weeks
  assert.equal(february.length, 4);
  assert.equal(february[0][0], '2027-02-01');
});

test('months step over the year', () => {
  assert.deepEqual(stepMonth(2026, 0, -1), [2025, 11]);
  assert.deepEqual(stepMonth(2026, 11, 1), [2027, 0]);
});

test('the calendar marks logged days, and stars the good ones — never the poor ones', () => {
  const meals = [meal('2026-06-03', 'Porridge', [], 90), meal('2026-06-10', 'Chips', [], 20), meal('2026-07-01', 'Soup')];
  const marks = monthMarks(meals, 2026, 5, targets);
  assert.deepEqual([...marks.entries()].sort(), [['2026-06-03', 'great'], ['2026-06-10', 'logged']]);
  assert.equal(firstLogged(meals, '2026-09-25'), '2026-06-03');
  assert.equal(firstLogged([], '2026-09-25'), '2026-09-25');
});

test('search finds every word, in the title or the items, ignoring case and accents, newest first', () => {
  const meals = [
    meal('2026-03-02', 'Lasagne', ['Beef lasagne', 'Side salad']),
    meal('2026-08-14', 'Dinner', ['Chicken breast', 'Rice']),
    meal('2026-05-01', 'Chicken wrap', ['Tortilla']),
    meal('2026-09-01', 'Pudding', ['Crème brûlée']),
    meal('2026-09-20', 'Lasagne again', []),
  ];
  assert.deepEqual(searchMeals(meals, 'LASAGNE').map((h) => h.meal.date), ['2026-09-20', '2026-03-02']);
  assert.deepEqual(searchMeals(meals, 'chicken rice').map((h) => h.meal.date), ['2026-08-14']);
  assert.deepEqual(searchMeals(meals, 'chicken rice')[0].items, ['Chicken breast', 'Rice']);
  assert.deepEqual(searchMeals(meals, 'creme').map((h) => h.meal.title), ['Pudding']);
  assert.deepEqual(searchMeals(meals, 'salad')[0].items, ['Side salad']);
  assert.deepEqual(searchMeals(meals, 'x'), [], 'one letter is not a search');
});
