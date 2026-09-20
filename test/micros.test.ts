import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMicros, addNutrients, computeTargets, microTargets, scaleMicros } from '../src/lib/nutrition';
import { FOODS, toFoodItem } from '../src/lib/foods';
import { MICROS } from '../src/types';
import { addMicroTargets, migrate } from '../src/store/useSquish';
import type { Micros, Nutrients, Profile, Targets } from '../src/types';

const person = (over: Partial<Profile> = {}): Profile => ({
  name: '', sex: 'female', age: 30, heightCm: 168, weightKg: 68, targetWeightKg: 63,
  activity: 'light', goal: 'maintain', pace: 0, units: 'metric', onboarded: true, ...over,
});

test('the UK reference intakes are the ones used', () => {
  const t = microTargets(person());
  assert.equal(t.calcium, 700, 'RNI, not the 800 on a label');
  assert.equal(t.vitaminD, 10, "SACN's figure, not the 5 still printed on labels");
  assert.equal(t.vitaminB12, 1.5);
  assert.equal(t.folate, 200);
  assert.equal(t.vitaminC, 40);
});

test('the iron figure follows menstrual losses, not sex alone', () => {
  assert.equal(microTargets(person({ sex: 'female', age: 30 })).iron, 14.8);
  assert.equal(microTargets(person({ sex: 'female', age: 62 })).iron, 8.7, 'and drops back after 50');
  assert.equal(microTargets(person({ sex: 'male', age: 30 })).iron, 8.7);
  assert.equal(microTargets(person({ sex: 'other', age: 30 })).iron, 14.8, 'the higher one when nobody said');
});

test('targets carry the micronutrients', () => {
  const t = computeTargets(person());
  for (const key of MICROS) assert.ok((t.micros?.[key] ?? 0) > 0, `${key} has a target`);
});

test('nobody said is not the same as none of it', () => {
  const plain: Nutrients = { calories: 100, protein: 5, carbs: 10, fat: 2, fibre: 1 };
  const known: Nutrients = { ...plain, micros: { iron: 2 } };

  assert.equal(addNutrients(plain, plain).micros, undefined, 'two unknowns stay unknown');
  assert.deepEqual(addNutrients(plain, known).micros, { iron: 2 }, 'what is known still counts');
  assert.deepEqual(addNutrients(known, known).micros, { iron: 4 });
});

test('a set that only knows some of them keeps the rest unknown', () => {
  const a: Micros = { iron: 2, calcium: 100 };
  const b: Micros = { calcium: 50, vitaminC: 20 };
  assert.deepEqual(addMicros(a, b), { iron: 2, calcium: 150, vitaminC: 20 });
  assert.equal(addMicros(undefined, undefined), undefined);
  assert.deepEqual(addMicros(undefined, b), { calcium: 50, vitaminC: 20 });
});

test('scaling a portion scales its vitamins with it', () => {
  assert.deepEqual(scaleMicros({ iron: 2, vitaminC: 15 }, 1.5), { iron: 3, vitaminC: 22.5 });
  assert.equal(scaleMicros(undefined, 2), undefined);
});

test('every food in the table carries all six, so a day does not silently under-report', () => {
  for (const food of FOODS) {
    const micros = food.per100.micros;
    assert.ok(micros, `${food.name} has no micronutrients`);
    for (const key of MICROS) {
      const amount: number | undefined = micros?.[key];
      assert.equal(typeof amount, 'number', `${food.name} is missing ${key}`);
      assert.ok((amount as number) >= 0, `${food.name}: negative ${key}`);
    }
  }
});

test('the figures are in the right units, which is where this goes wrong', () => {
  const find = (id: string) => FOODS.find((f) => f.id === id)!.per100.micros!;

  // Milligrams for the minerals: cheddar is a calcium food, at 720 mg/100 g.
  assert.ok(find('cheddar').calcium! > 500, 'calcium in mg, not g');
  // Micrograms for vitamin D: salmon is about 11 µg/100 g, not 0.000011.
  assert.ok(find('salmon').vitaminD! > 5 && find('salmon').vitaminD! < 30);
  // Micrograms for B12 too.
  assert.ok(find('salmon').vitaminB12! > 1 && find('salmon').vitaminB12! < 10);
  // And vitamin C in mg: strawberries beat oranges, which surprises people.
  assert.ok(find('strawberries').vitaminC! > 50);
  assert.ok(find('olive-oil').vitaminC === 0, 'oil has none of it');
});

test('the fortified ones are fortified — British flour is, by law', () => {
  const micros = (id: string) => FOODS.find((f) => f.id === id)!.per100.micros!;
  assert.ok(micros('bread').iron! > micros('oats').iron! / 2, 'flour carries added iron');
  assert.ok(micros('cereal').iron! > 10, 'and breakfast cereal carries a great deal more');
  assert.ok(micros('cereal').folate! > 100);
});

test('a real portion works out sensibly against a real target', () => {
  const spinach = toFoodItem(FOODS.find((f) => f.id === 'spinach')!); // 80 g
  const target = microTargets(person());

  const folateShare = (spinach.nutrients.micros!.folate! / target.folate!) * 100;
  assert.ok(folateShare > 60 && folateShare < 95, `a handful of spinach is most of a day's folate, got ${Math.round(folateShare)}%`);
});

test('animal foods carry B12 and plants do not', () => {
  const micros = (id: string) => FOODS.find((f) => f.id === id)!.per100.micros!;
  assert.ok(micros('beef-mince').vitaminB12! > 1);
  assert.ok(micros('salmon').vitaminB12! > 1);
  assert.equal(micros('lentils').vitaminB12, 0);
  assert.equal(micros('broccoli').vitaminB12, 0);
});

/* ------------------------------------------------------------------ *
 * The bug: targets that predate the feature.
 * ------------------------------------------------------------------ */

test('targets saved before micronutrients existed get them', () => {
  const before = {
    profile: person({ sex: 'female', age: 29 }),
    targets: { calories: 1900, protein: 120, carbs: 210, fat: 63, fibre: 27, water: 9, steps: 10000 },
  };
  const after = addMicroTargets(before, 3) as { targets: Targets };

  assert.equal(after.targets.micros?.calcium, 700);
  assert.equal(after.targets.micros?.iron, 14.8, 'and worked out from their own profile');
  assert.equal(after.targets.calories, 1900, 'nothing else is touched');
});

test('the iron figure in a migrated target follows the profile it came from', () => {
  const male = addMicroTargets(
    { profile: person({ sex: 'male' }), targets: { calories: 2400 } },
    3,
  ) as { targets: Targets };
  assert.equal(male.targets.micros?.iron, 8.7);
});

test('targets that already have them are left alone', () => {
  const mine = { profile: person(), targets: { calories: 1900, micros: { iron: 20 } } };
  assert.equal((addMicroTargets(mine, 3) as { targets: Targets }).targets.micros?.iron, 20);
});

test('it does not run twice, or on a store with nothing to migrate', () => {
  const store = { profile: person(), targets: { calories: 1900 } };
  assert.deepEqual(addMicroTargets(store, 4), store, 'already migrated');
  assert.deepEqual(addMicroTargets({ profile: person() }, 3), { profile: person() }, 'no targets at all');
  assert.equal(addMicroTargets(undefined, 3), undefined);
});

test('every migration still runs, in order, from the oldest store', () => {
  const oldFat = Math.round((2000 * 0.28) / 9);
  const ancient = {
    profile: { ...person(), plateCm: 27, bowlMl: 400 },
    targets: { calories: 2000, protein: 120, fat: oldFat, carbs: 241 },
  };
  const after = migrate(ancient, 1) as { profile: Profile; targets: Targets };

  assert.equal(after.targets.fat, 67, 'v1: the fat target was raised');
  assert.equal(after.profile.plateCm, undefined, 'v2: the assumed plate cleared');
  assert.equal(after.targets.micros?.calcium, 700, 'v3: and the micronutrients filled in');
});
