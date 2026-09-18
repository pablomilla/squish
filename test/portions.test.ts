import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describePortion, formatDrinkVolume, formatFoodWeight } from '../src/lib/units';
import { FOODS, toFoodItem } from '../src/lib/foods';

test('a portion weight is given in grams and ounces', () => {
  assert.equal(formatFoodWeight(320), '320 g (11 oz)');
  assert.equal(formatFoodWeight(100), '100 g (3.5 oz)');
  assert.equal(formatFoodWeight(28.35), '28 g (1 oz)');
});

test('ounces are rounded like the estimate they are', () => {
  // Fine detail under ten ounces, whole ounces above — nobody needs 11.29 oz of stew.
  assert.equal(formatFoodWeight(14), '14 g (0.5 oz)');
  assert.equal(formatFoodWeight(568), '568 g (20 oz)');
});

test('the words say what it was, the weight says how much', () => {
  assert.equal(describePortion('1 bowl', 400), '1 bowl · 400 g (14 oz)');
  assert.equal(describePortion('1 medium', 118), '1 medium · 118 g (4.2 oz)');
});

test('a weight already in the words is not said twice', () => {
  // Meals logged before the app formatted weights itself still read properly.
  assert.equal(describePortion('1 bowl (320 g)', 320), '1 bowl · 320 g (11 oz)');
  assert.equal(describePortion('1 tin (110 g)', 110), '1 tin · 110 g (3.9 oz)');
  assert.equal(describePortion('100 g', 100), '100 g (3.5 oz)');
});

test('a portion with no weight behind it is left as it was written', () => {
  assert.equal(describePortion('1 entry'), '1 entry');
  assert.equal(describePortion('1 bowl', 0), '1 bowl');
});

test('doubling a portion doubles the weight shown with it', () => {
  const food = FOODS.find((f) => f.id === 'egg')!;
  const one = toFoodItem(food, 1);
  const two = toFoodItem(food, 2);
  assert.equal(describePortion(one.portion, one.grams), '1 medium egg · 55 g (1.9 oz)');
  assert.equal(describePortion(two.portion, two.grams), '2 × 1 medium egg · 110 g (3.9 oz)');
});

test('a drink is measured by volume, not weight', () => {
  assert.equal(describePortion('1 glass', 250, true), '1 glass · 250 ml (8.8 fl oz)');
  assert.equal(describePortion('1 can', 330, true), '1 can · 330 ml (12 fl oz)');
});

test('a pint comes out as twenty fluid ounces, which is the point of the imperial one', () => {
  assert.equal(formatDrinkVolume(568), '568 ml (20 fl oz)');
});

test('every drink in the table is marked as one, so none of them are weighed', () => {
  for (const food of FOODS.filter((f) => f.tags.includes('drink'))) {
    const item = toFoodItem(food);
    assert.equal(item.liquid, true, `${food.name} is not marked as a drink`);
    assert.ok(describePortion(item.portion, item.grams, item.liquid).includes('fl oz'), `${food.name}: shown by weight`);
  }
});

test('every label in the food table states its measure exactly once', () => {
  for (const food of FOODS) {
    const item = toFoodItem(food);
    const shown = describePortion(item.portion, item.grams, item.liquid);
    assert.ok(/(oz|fl oz)/.test(shown), `${food.name}: no converted measure`);
    assert.equal((shown.match(/\d+\s*(?:g|ml)\b/g) ?? []).length, 1, `${food.name}: "${shown}" states it twice`);
  }
});
