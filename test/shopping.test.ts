import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AISLES, aisleOf, listAsText, shopAmount, shoppingList } from '../src/lib/shopping';
import { MEAL_SCHEMA, toAnalysis } from '../server/claude';
import type { FoodItem, MealEntry } from '../src/types';

/**
 * The shopping list is made from plans: the same food added up across meals,
 * in the order a shop is walked, for the days asked about and no others.
 */
const nut = { calories: 100, protein: 5, carbs: 10, fat: 3, fibre: 1 };
const item = (name: string, portion: string, grams?: number, liquid = false): FoodItem => ({ id: name, name, portion, grams, liquid, nutrients: nut });
const plan = (date: string, title: string, items: FoodItem[]): MealEntry => ({
  id: `${date}-${title}`, date, time: '', slot: 'dinner', title, items, nutrients: nut, score: 70, source: 'describe',
});

test('aisles are guessed sensibly, including the names that sound like somewhere else', () => {
  const cases: [string, string][] = [
    ['Chicken breast', 'meat-fish'], ['Chicken stock cube', 'cupboard'], ['Salmon fillet', 'meat-fish'],
    ['Red pepper', 'fruit-veg'], ['Black pepper', 'cupboard'], ['Green beans', 'fruit-veg'], ['Baked beans', 'cupboard'],
    ['Butternut squash', 'fruit-veg'], ['Orange squash', 'drinks'], ['Orange juice', 'drinks'], ['Banana', 'fruit-veg'],
    ['Greek yoghurt', 'dairy-eggs'], ['Coconut milk', 'cupboard'], ['Peanut butter', 'cupboard'], ['Eggs', 'dairy-eggs'],
    ['Wholemeal bread', 'bakery'], ['Tortilla wrap', 'bakery'], ['Frozen peas', 'frozen'], ['Ice cream', 'frozen'],
    ['Basmati rice', 'cupboard'], ['Washing-up liquid', 'other'],
  ];
  for (const [name, aisle] of cases) assert.equal(aisleOf(name), aisle, name);
});

test('amounts: a shop’s sort of number', () => {
  assert.equal(shopAmount(452, false), '450 g');
  assert.equal(shopAmount(37, false), '35 g');
  assert.equal(shopAmount(2, false), '5 g');
  assert.equal(shopAmount(1234, false), '1.2 kg');
  assert.equal(shopAmount(1500, true), '1.5 litres');
  assert.equal(shopAmount(330, true), '330 ml');
});

test('the same food is one line across meals, added up; only the days asked for', () => {
  const plans = [
    plan('2026-09-28', 'Stir-fry', [item('Chicken breast', '1 breast', 160), item('Rice', '1 portion', 180), item('red pepper', '1 pepper', 150)]),
    plan('2026-09-30', 'Chicken wrap', [item('chicken breast ', '1 breast', 140), item('Tortilla wrap', '1 wrap'), item('Eggs', '2 eggs')]),
    plan('2026-10-01', 'Omelette', [item('Eggs', '2 eggs')]),
    plan('2026-10-09', 'Too far off', [item('Lamb shank', '1 shank', 400)]),
  ];
  const lines = shoppingList(plans, '2026-09-28', '2026-10-04');
  const byName = Object.fromEntries(lines.map((l) => [l.name.toLowerCase(), l]));
  assert.equal(byName['chicken breast'].amount, '300 g');
  assert.deepEqual(byName['chicken breast'].meals, ['Stir-fry', 'Chicken wrap']);
  assert.equal(byName.eggs.amount, '2 × 2 eggs', 'no weights: counted portions');
  assert.equal(byName['tortilla wrap'].amount, '1 wrap');
  assert.ok(!byName['lamb shank'], 'a plan outside the days asked for');
  assert.deepEqual(
    lines.map((l) => l.aisle),
    ['fruit-veg', 'meat-fish', 'dairy-eggs', 'bakery', 'cupboard'],
    'aisle order',
  );
});

test('as text: by aisle, ticked lines left off, own additions at the end', () => {
  const lines = shoppingList([plan('2026-09-28', 'Tea', [item('Banana', '1 banana', 120), item('Oats', '1 bowl', 50)])], '2026-09-28', '2026-09-28');
  const text = listAsText(lines, [{ id: 'x', name: 'Washing-up liquid' }, { id: 'y', name: 'Bin bags' }], new Set(['oats', 'extra:y']));
  assert.equal(text, ['Shopping list', '', 'Fruit & veg', '- Banana (120 g)', '', 'Also', '- Washing-up liquid'].join('\n'));
});

test('ticks and hand-added lines live in the store, and "done shopping" clears what was ticked', async () => {
  const { useSquish } = await import('../src/store/useSquish');
  const s = useSquish.getState();
  s.resetAll();
  s.addShoppingExtra('  Bin bags  ');
  s.addShoppingExtra('   ');
  s.addShoppingExtra('Foil');
  const [bags, foil] = useSquish.getState().shopping.extras;
  assert.deepEqual([bags.name, foil.name], ['Bin bags', 'Foil']);
  s.toggleShoppingTick('banana');
  s.toggleShoppingTick(`extra:${bags.id}`);
  s.toggleShoppingTick('oats');
  s.toggleShoppingTick('oats');
  assert.deepEqual(useSquish.getState().shopping.ticked, ['banana', `extra:${bags.id}`]);
  s.clearShoppingTicked();
  assert.deepEqual(useSquish.getState().shopping, { ticked: [], extras: [foil] });
  useSquish.getState().resetAll();
});

test('a meal from a photo or a description knows its aisles, whatever language it is named in', () => {
  // What the model is asked for: an aisle on every item, from the shopping list's own.
  const itemSchema = MEAL_SCHEMA.properties.items.items;
  assert.ok((itemSchema.required as readonly string[]).includes('aisle'));
  assert.deepEqual(itemSchema.properties.aisle.enum, AISLES.map((a) => a.id));

  // A meal described in Spanish, planned for later.
  const analysis = toAnalysis({
    title: 'Pollo con arroz',
    items: [
      { name: 'Pechuga de pollo', portion: '1 pechuga', grams: 160, aisle: 'meat-fish', nutrients: nut },
      { name: 'Arroz basmati', portion: '1 ración', grams: 180, aisle: 'cupboard', nutrients: nut },
      { name: 'Pimiento rojo', portion: '1 pimiento', grams: 150, aisle: 'fruit-veg', nutrients: nut },
      { name: 'Algo raro', portion: '1', grams: 10, aisle: 'the moon', nutrients: nut },
    ],
  });
  const lines = shoppingList([plan('2026-09-28', 'Pollo con arroz', analysis.items)], '2026-09-28', '2026-09-28');
  const aisle = (name: string) => lines.find((l) => l.name === name)?.aisle;
  assert.equal(aisle('Pechuga de pollo'), 'meat-fish');
  assert.equal(aisle('Arroz basmati'), 'cupboard');
  assert.equal(aisle('Pimiento rojo'), 'fruit-veg');
  assert.equal(aisle('Algo raro'), 'other', 'an aisle that is not one is dropped, and the name guessed from');
  // Before, all of these went by the English name guess, and so to "Other".
  assert.equal(aisleOf('Pechuga de pollo'), 'other');
});
