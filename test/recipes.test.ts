import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRecipe, madeOf, orderRecipes, recipeFrom, searchRecipes } from '../src/lib/recipes';
import { likesFrom } from '../src/lib/planner';
import type { FoodItem, MealEntry, Nutrients, Recipe } from '../src/types';

/**
 * The recipe box. A recipe is one portion as it is logged; how often it has
 * been made is read from the diary by name, so it cannot drift from what was
 * eaten; and the box leads what the week's plan is told they like.
 */
const nut = (calories: number): Nutrients => ({ calories, protein: 30, carbs: 40, fat: 12, fibre: 6 });
const item = (name: string): FoodItem => ({ id: name, name, portion: '1 portion', grams: 100, nutrients: nut(200) });
let n = 0;
const recipe = (title: string, savedAt: string, items = [item('rice')]): Recipe => ({ id: `r${n++}`, title, slot: 'dinner', items, nutrients: nut(550), score: 80, savedAt });
const eaten = (title: string, date: string): MealEntry => ({ id: `m${n++}`, date, time: '19:00', slot: 'dinner', title, items: [], nutrients: nut(550), score: 80, source: 'describe' });

test('a meal becomes a recipe as it is: one portion, its steps, where it came from', () => {
  const r = recipeFrom({ title: '  Salmon traybake ', items: [item('salmon')], nutrients: nut(600), score: 88, cook: { minutes: 25, steps: ['Bake it.'] } }, '2026-09-29', 'https://example.com/salmon');
  assert.deepEqual(r, {
    title: 'Salmon traybake', slot: 'dinner', items: [item('salmon')], nutrients: nut(600), score: 88,
    cook: { minutes: 25, steps: ['Bake it.'] }, sourceUrl: 'https://example.com/salmon', savedAt: '2026-09-29',
  });
  assert.equal('sourceUrl' in recipeFrom({ title: 'Toast', slot: 'breakfast', items: [], nutrients: nut(200), score: 50 }, '2026-09-29'), false);
});

test('a recipe is known by its name, whatever the capitals', () => {
  const box = [recipe('Chickpea curry', '2026-09-01')];
  assert.equal(findRecipe(box, 'chickpea CURRY ')?.id, box[0].id);
  assert.equal(findRecipe(box, 'Chickpea stew'), undefined);
  assert.equal(findRecipe(box, '  '), undefined);
});

test('how often it has been made is read from the diary', () => {
  const meals = [eaten('Chickpea curry', '2026-09-10'), eaten('chickpea curry', '2026-09-20'), eaten('Soup', '2026-09-21')];
  assert.deepEqual(madeOf({ title: 'Chickpea Curry' }, meals), { times: 2, last: '2026-09-20' });
  assert.deepEqual(madeOf({ title: 'Lasagne' }, meals), { times: 0, last: undefined });
});

test('the box is in the order it is used: most made, then newest saved', () => {
  const box = [recipe('Soup', '2026-09-01'), recipe('Curry', '2026-09-05'), recipe('Tacos', '2026-09-20'), recipe('Salad', '2026-09-10')];
  const meals = [eaten('Soup', '2026-09-12'), eaten('Soup', '2026-09-19'), eaten('Salad', '2026-09-15')];
  assert.deepEqual(orderRecipes(box, meals).map((r) => r.title), ['Soup', 'Salad', 'Tacos', 'Curry']);
});

test('searching finds a word in the name or the ingredients, every word asked', () => {
  const box = [recipe('Chickpea curry', '2026-09-01', [item('chickpeas'), item('spinach')]), recipe('Tuna pasta', '2026-09-02', [item('pasta'), item('tuna')])];
  assert.deepEqual(searchRecipes(box, 'spinach').map((r) => r.title), ['Chickpea curry']);
  assert.deepEqual(searchRecipes(box, 'PASTA tuna').map((r) => r.title), ['Tuna pasta']);
  assert.deepEqual(searchRecipes(box, 'curry tuna'), []);
  assert.equal(searchRecipes(box, '  ').length, 2, 'nothing typed: everything');
});

test('saved recipes lead what the nutritionist is told they like, after kept meals, the most made first', () => {
  const box = [recipe('Tacos', '2026-09-20'), recipe('Soup', '2026-09-01')];
  const meals = [eaten('Soup', '2026-09-12'), eaten('Soup', '2026-09-19'), eaten('Chicken wrap', '2026-09-25'), eaten('Chicken wrap', '2026-09-24'), eaten('Chicken wrap', '2026-09-23')];
  const kept: MealEntry = { ...eaten('Lentil pie', '2026-09-30'), kept: true };
  assert.deepEqual(likesFrom(meals, [], '2026-09-26', 15, [kept], box), ['Lentil pie', 'Soup', 'Tacos', 'Chicken wrap']);
});
