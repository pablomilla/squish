import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SOLO, cleanHousehold, servingsFor } from '../src/lib/planner';
import { shoppingList } from '../src/lib/shopping';
import { cleanCookAsk, cookKey, cookPrompt } from '../server/cook';
import { cleanWeekRequest, weekPlanPrompt } from '../server/weekplan';
import type { FoodItem, MealEntry, MealSlot } from '../src/types';

/**
 * Cooking for more than one: the recipe and the shopping are multiplied,
 * the diary never is. Dinner is the meal a household shares unless they say
 * every meal is, and any one meal can say otherwise for itself.
 */
const nut = { calories: 500, protein: 30, carbs: 50, fat: 15, fibre: 6 };
const item = (name: string, portion: string, grams?: number): FoodItem => ({ id: name, name, portion, grams, nutrients: nut });
const plan = (slot: MealSlot, title: string, items: FoodItem[], over: Partial<MealEntry> = {}): MealEntry => ({
  id: `${slot}-${title}`, date: '2026-09-30', time: '', slot, title, items, nutrients: nut, score: 70, source: 'describe', ...over,
});

test('a household is made sensible: one to eight people, dinners shared unless every meal is', () => {
  assert.deepEqual(cleanHousehold(undefined), SOLO);
  assert.deepEqual(cleanHousehold({ people: 3.4, shared: 'all' }), { people: 3, shared: 'all' });
  assert.deepEqual(cleanHousehold({ people: 40, shared: 'brunch' as never }), { people: 8, shared: 'dinner' });
  assert.deepEqual(cleanHousehold({ people: -2 }), { people: 1, shared: 'dinner' });
});

test('a meal is cooked for the household when it is shared, for one when not, and for its own number when it says', () => {
  const family = { people: 4, shared: 'dinner' as const };
  assert.equal(servingsFor({ slot: 'dinner' }, family), 4);
  assert.equal(servingsFor({ slot: 'lunch' }, family), 1, 'lunch is their own unless every meal is shared');
  assert.equal(servingsFor({ slot: 'lunch' }, { people: 4, shared: 'all' }), 4);
  assert.equal(servingsFor({ slot: 'lunch', servings: 3 }, family), 3, 'a meal can say for itself');
  assert.equal(servingsFor({ slot: 'dinner' }), 1, 'no household: just them');
});

test('the shopping list is each meal times however many it is cooked for', () => {
  const plans = [
    plan('dinner', 'Chilli', [item('Kidney beans', '½ tin', 120), item('Tortilla wrap', '1 wrap')]),
    plan('lunch', 'Beans on toast', [item('Kidney beans', '½ tin', 100)]),
  ];
  const lines = shoppingList(plans, '2026-09-30', '2026-09-30', { people: 3, shared: 'dinner' });
  const find = (name: string) => lines.find((l) => l.name === name)!;
  assert.equal(find('Kidney beans').amount, '460 g', 'three dinners’ worth (360 g) and one lunch (100 g)');
  assert.equal(find('Tortilla wrap').amount, '3 × 1 wrap', 'unweighed things are counted out');
  assert.equal(shoppingList(plans, '2026-09-30', '2026-09-30').find((l) => l.name === 'Kidney beans')!.amount, '220 g', 'on their own, as before');
});

test('steps for several are asked for with the amounts already multiplied, and end by sharing it out', () => {
  const meal = { title: 'Chickpea curry', slot: 'dinner', items: [{ name: 'chickpeas', portion: '½ tin', grams: 120 }, { name: 'coconut milk', portion: '100 ml', grams: 100, liquid: true }] };
  const four = cleanCookAsk({ ...meal, servings: 4 })!;
  const prompt = cookPrompt(four);
  assert.match(prompt, /Cooked for 4 people\. Ingredients, for all 4:/);
  assert.match(prompt, /- chickpeas \(4 × ½ tin, 480 g\)/);
  assert.match(prompt, /- coconut milk \(4 × 100 ml, 400 ml\)/);
  assert.match(prompt, /divides it into 4 equal portions/);
  assert.match(cookPrompt(cleanCookAsk(meal)!), /Ingredients, for one:\n- chickpeas \(½ tin, 120 g\)/, 'one, as before');
  assert.equal(cleanCookAsk({ ...meal, servings: 99 })!.servings, 8);
  assert.equal(cleanCookAsk({ ...meal, servings: 'lots' })!.servings, 1);

  const gb = { language: 'en', region: 'GB' };
  assert.notEqual(cookKey(four, gb), cookKey(cleanCookAsk(meal)!, gb), 'steps for four are not the steps for one');
  assert.equal(cookKey(cleanCookAsk({ ...meal, servings: 1 })!, gb), cookKey(cleanCookAsk(meal)!, gb), 'steps kept for one before servings existed are still found');
});

test('the week’s plan is told who else is eating, and that its portions are still theirs alone', () => {
  const base = { startDate: '2026-09-28', days: 3, calorieTarget: 1900, sex: 'female' };
  const req = cleanWeekRequest({ ...base, household: { people: 4, shared: 'dinner' } })!;
  assert.deepEqual(req.household, { people: 4, shared: 'dinner' });
  assert.match(weekPlanPrompt(req), /They cook dinner for 4 people, themselves included, so plan dinners that suit a shared table\. Every portion you give is still for them alone/);
  assert.equal(cleanWeekRequest({ ...base, household: { people: 1 } })!.household, undefined, 'just them: nothing to say');
  assert.doesNotMatch(weekPlanPrompt(cleanWeekRequest(base)!), /They cook/);
});
