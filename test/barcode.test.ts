import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toAnalysis } from '../server/barcode';
import { looksLikeBarcode } from '../src/lib/gtin';

/**
 * The nutriments block from Open Food Facts' own published example response
 * for barcode 3017620422003, copied field-for-field. Their figures are per
 * 100 g, their sodium is in grams, and their carbohydrate excludes fibre.
 */
const NUTELLA = {
  'energy-kcal_100g': 539,
  'energy-kj_100g': 2252,
  carbohydrates_100g: 57.5,
  fat_100g: 30.9,
  proteins_100g: 6.3,
  salt_100g: 0.107,
  sodium_100g: 0.0428,
  sugars_100g: 56.3,
  'saturated-fat_100g': 10.6,
};

test('a barcode is digits, and the right number of them', () => {
  for (const good of ['3017620422003', '50184453', '501844531234']) {
    assert.ok(looksLikeBarcode(good), `${good} should be accepted`);
  }
  for (const bad of ['', '123', 'abcdefgh', '30176204220031234', 'https://example.com']) {
    assert.ok(!looksLikeBarcode(bad), `${bad} should be rejected`);
  }
});

test('per-100g figures are scaled to the stated serving', () => {
  const analysis = toAnalysis(
    { product_name: 'Nutella', serving_size: '15g', serving_quantity: '15', nutriments: NUTELLA },
    '3017620422003',
  )!;
  const item = analysis.items[0];

  assert.equal(item.name, 'Nutella');
  assert.equal(item.grams, 15);
  assert.equal(item.portion, '15g');
  assert.equal(item.nutrients.calories, Math.round(539 * 0.15));
  assert.equal(item.nutrients.fat, 4.6);
});

test('sodium arrives in grams and has to become milligrams', () => {
  // 0.0428 g per 100 g is 42.8 mg — reading it as 0.0428 mg would make every
  // packaged food look salt-free.
  const per100 = toAnalysis({ product_name: 'Nutella', nutriments: NUTELLA }, '3017620422003')!;
  assert.equal(per100.items[0].grams, 100);
  assert.equal(per100.items[0].nutrients.sodium, 43);
});

test('salt is used when sodium is missing, at the right ratio', () => {
  const { sodium_100g: _dropped, ...noSodium } = NUTELLA;
  const analysis = toAnalysis({ product_name: 'Nutella', nutriments: noSodium }, '1')!;
  // 0.107 g of salt is 0.0428 g of sodium is 43 mg.
  assert.equal(analysis.items[0].nutrients.sodium, 43);
});

test('fibre is folded into carbohydrate, because Europe leaves it out', () => {
  // An EU label declaring 20 g carbohydrate and 5 g fibre means 25 g total
  // the way this app counts it. Taking their figure as-is loses the fibre.
  const analysis = toAnalysis(
    { product_name: 'Bran', nutriments: { 'energy-kcal_100g': 300, carbohydrates_100g: 20, fiber_100g: 5 } },
    '1',
  )!;
  assert.equal(analysis.items[0].nutrients.carbs, 25);
  assert.equal(analysis.items[0].nutrients.fibre, 5);
});

test('an American gross carbohydrate figure is taken as it stands', () => {
  const analysis = toAnalysis(
    {
      product_name: 'Cereal',
      nutriments: { 'energy-kcal_100g': 300, 'carbohydrates-total_100g': 25, carbohydrates_100g: 20, fiber_100g: 5 },
    },
    '1',
  )!;
  assert.equal(analysis.items[0].nutrients.carbs, 25, 'not 30 — that would count the fibre twice');
});

test('energy given only in kilojoules is converted', () => {
  const analysis = toAnalysis(
    { product_name: 'KJ only', nutriments: { 'energy-kj_100g': 2252, carbohydrates_100g: 10 } },
    '1',
  )!;
  assert.equal(analysis.items[0].nutrients.calories, Math.round(2252 / 4.184));
});

test('a product with no energy at all is refused rather than logged as zero', () => {
  assert.equal(toAnalysis({ product_name: 'Mystery', nutriments: { proteins_100g: 5 } }, '1'), null);
  assert.equal(toAnalysis({ product_name: 'Empty' }, '1'), null);
});

test('a daft serving size falls back to 100 g', () => {
  for (const quantity of ['0', '99999', 'not a number', undefined]) {
    const analysis = toAnalysis({ product_name: 'Odd', serving_quantity: quantity, nutriments: NUTELLA }, '1')!;
    assert.equal(analysis.items[0].grams, 100, `serving_quantity ${quantity} should not be trusted`);
  }
});

test('a drink is marked as one so it reads in millilitres', () => {
  const analysis = toAnalysis(
    { product_name: 'Cola', serving_quantity: '330', serving_quantity_unit: 'ml', nutriments: NUTELLA },
    '1',
  )!;
  assert.equal(analysis.items[0].liquid, true);
});

test('a nameless product still logs, under its number', () => {
  const analysis = toAnalysis({ nutriments: NUTELLA }, '5012345678900')!;
  assert.equal(analysis.items[0].name, 'Item 5012345678900');
});

test('the meal total matches the single item it contains', () => {
  const analysis = toAnalysis({ product_name: 'Nutella', serving_quantity: '15', nutriments: NUTELLA }, '1')!;
  assert.equal(analysis.nutrients.calories, analysis.items[0].nutrients.calories);
});

test('saturates come across, scaled to the serving like everything else', () => {
  const item = toAnalysis(
    { product_name: 'Nutella', serving_size: '15g', serving_quantity: '15', nutriments: NUTELLA },
    '3017620422003',
  )!.items[0];

  assert.equal(item.nutrients.satFat, 1.6, '10.6 g per 100 g, over a 15 g serving');
  assert.ok((item.nutrients.satFat as number) < item.nutrients.fat, 'and it sits inside the fat');
});

test('a product with no saturates figure is left blank, not called nought', () => {
  const { 'saturated-fat_100g': _omitted, ...noSat } = NUTELLA;
  const item = toAnalysis({ product_name: 'Mystery', serving_quantity: '15', nutriments: noSat }, '3017620422003')!.items[0];

  assert.equal(item.nutrients.satFat, undefined);
});
