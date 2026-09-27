import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDishes, sample, toFixture } from '../scripts/nutrition5k';
import { paperScore, predictionsCsv, type Attempt } from '../scripts/bench';

/**
 * Nutrition5k as a benchmark set: its CSV read as the dataset writes it, the
 * same dishes for the same seed, and results scored the paper's way so they
 * can sit beside its table.
 */

// Two real lines from dish_metadata_cafe1.csv (the second trimmed), and one that is not a dish.
const CSV = [
  'dish_1562688426,137.569992,88.000000,8.256000,5.190000,10.297000,ingr_0000000433,roasted potatoes,17.000000,23.97,1.156,3.06,0.357,ingr_0000000510,chicken apple sausage,71.000000,113.6,7.1,2.13,9.94',
  'dish_1561662216,300.794281,193.000000,12.387489,28.218290,18.633970,ingr_0000000508,soy sauce,3.398568,1.80124104,0.020391408,0.166529832,0.275284008',
  'not,a,dish',
  '',
].join('\n');

test('the dish metadata is read as the dataset writes it', () => {
  const dishes = parseDishes(CSV);
  assert.equal(dishes.size, 2);
  const dish = dishes.get('dish_1562688426')!;
  assert.deepEqual(
    { calories: dish.calories, grams: dish.grams, fat: dish.fat, carbs: dish.carbs, protein: dish.protein },
    { calories: 137.569992, grams: 88, fat: 8.256, carbs: 5.19, protein: 10.297 },
    'total calories, mass, fat, carbohydrate, protein — in that order',
  );
  assert.deepEqual(dish.ingredients, ['roasted potatoes', 'chicken apple sausage']);

  const fixture = toFixture(dish);
  assert.equal(fixture.name, 'dish_1562688426', 'every result traces back to the dataset');
  assert.equal(fixture.file, 'dish_1562688426.png');
  assert.equal(fixture.grams, 88, 'the weighed mass, so portions are scored too');
  assert.equal(fixture.slot, undefined, 'no meal of the day is suggested to the model');
  assert.match(fixture.source!, /CC BY 4\.0/);
});

test('the same seed picks the same dishes, and another seed others', () => {
  const ids = Array.from({ length: 50 }, (_, i) => `dish_${i}`);
  assert.deepEqual(sample(ids, 10, 1), sample(ids, 10, 1));
  assert.notDeepEqual(sample(ids, 10, 1), sample(ids, 10, 2));
  assert.equal(new Set(sample(ids, 50, 3)).size, 50, 'no dish twice');
});

test('scored the paper’s way: error as a share of the mean true value, not the mean of each dish’s share', () => {
  const fixtures = [
    { file: 'a.png', name: 'a', calories: 100, protein: 10, carbs: 10, fat: 5, grams: 100 },
    { file: 'b.png', name: 'b', calories: 900, protein: 30, carbs: 90, fat: 40, grams: 400 },
  ];
  const attempt = (meal: string, calories: number, grams: number): Attempt => ({
    model: 'm', meal, run: 1, variant: 'default', ok: true, predictedGrams: grams,
    predicted: { calories, protein: 20, carbs: 50, fat: 20 },
  });
  const attempts = [attempt('a', 200, 150), attempt('b', 800, 400), { ...attempt('b', 0, 0), ok: false, predicted: undefined }];
  const score = paperScore('m', attempts, fixtures);
  assert.equal(score.dishes, 2, 'a failed attempt is counted as a failure elsewhere, not as a zero here');
  assert.equal(score.calories.mae, 100);
  // (100 + 100) / 2 over a mean of 500 — the small dish's 100% miss does not dominate.
  assert.equal(score.calories.pct, 0.2);
  assert.equal(score.mass.mae, 25);
  assert.equal(predictionsCsv('m', attempts), 'a,200,150,20,50,20\nb,800,400,20,50,20', 'Google’s script’s columns: dish_id,calories,mass,fat,carb,protein');
});
