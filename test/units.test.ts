import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FEET_RANGE,
  HEIGHT_CM_RANGE,
  MAX_POUNDS_IN_STONE,
  STARTING_WEIGHTS,
  STONE_RANGE,
  WEIGHT_KG_RANGE,
  cmToFeetInches,
  feetInchesToCm,
  formatHeight,
  formatPace,
  formatWeight,
  formatWeightDelta,
  kgToPounds,
  kgToStonePounds,
  paceToKg,
  poundsToKg,
  retuneForUnits,
  saltGrams,
  sodiumMg,
  stonePoundsToKg,
} from '../src/lib/units';
import { GLASS_ML, waterVolume } from '../src/lib/nutrition';

test('height converts both ways without drifting', () => {
  assert.deepEqual(cmToFeetInches(168), { feet: 5, inches: 6 });
  assert.deepEqual(cmToFeetInches(183), { feet: 6, inches: 0 });
  assert.equal(feetInchesToCm(5, 6), 168);
  assert.equal(feetInchesToCm(6, 0), 183);

  // Round-tripping every realistic height must stay within a centimetre.
  for (let cm = 120; cm <= 220; cm += 1) {
    const { feet, inches } = cmToFeetInches(cm);
    assert.ok(Math.abs(feetInchesToCm(feet, inches) - cm) <= 1, `${cm}cm drifted`);
    assert.ok(inches >= 0 && inches < 12, `${cm}cm gave ${inches} inches`);
  }
});

test('weight converts both ways in stones and pounds', () => {
  const { stone, pounds } = kgToStonePounds(68);
  assert.equal(stone, 10);
  assert.ok(Math.abs(pounds - 9.9) < 0.15, `got ${pounds} lb`); // 68 kg = 149.9 lb = 10 st 9.9 lb
  assert.ok(Math.abs(stonePoundsToKg(10, 9.9) - 68) < 0.1);
});

test('pounds never round up into a phantom fourteenth', () => {
  // 69.85 kg is 10 st 13.99 lb — it must carry, not read "10 st 14 lb".
  for (let kg = 35; kg <= 250; kg += 0.05) {
    const { pounds } = kgToStonePounds(kg);
    assert.ok(pounds < 14, `${kg.toFixed(2)}kg produced ${pounds} lb`);
    assert.ok(pounds >= 0);
  }
});

test('the pounds field accepts every value the conversion can produce', () => {
  // The field clamps to MAX_POUNDS_IN_STONE on blur. If any weight converts to
  // more than that, blurring the field silently loses part of the weight.
  let worst = 0;
  for (let kg = 35; kg <= 250; kg += 0.01) {
    worst = Math.max(worst, kgToStonePounds(kg).pounds);
  }
  assert.ok(worst <= MAX_POUNDS_IN_STONE, `conversion produced ${worst} lb, field caps at ${MAX_POUNDS_IN_STONE}`);
});

test('a weight survives a round trip through stones and back', () => {
  for (const kg of [68, 82.5, 76.2, 99.9, 45.4]) {
    const { stone, pounds } = kgToStonePounds(kg);
    const back = stonePoundsToKg(stone, Math.min(pounds, MAX_POUNDS_IN_STONE));
    assert.ok(Math.abs(back - kg) < 0.1, `${kg}kg came back as ${back}kg`);
  }
});

test('plain pounds round-trip for the diary stepper', () => {
  assert.equal(kgToPounds(68), 150);
  assert.ok(Math.abs(poundsToKg(150) - 68) < 0.1);
});

test('formatting reads the way each audience expects', () => {
  assert.equal(formatHeight(168, 'metric'), '168 cm');
  assert.equal(formatHeight(168, 'imperial'), '5′ 6″');
  assert.equal(formatWeight(68, 'metric'), '68 kg');
  assert.match(formatWeight(68, 'imperial'), /^10 st 9\.9 lb$/);
  assert.equal(formatWeight(88.9, 'imperial'), '14 st', 'a whole number of stone drops the pounds');
});

test('a weight change is signed, so a loss reads as a loss', () => {
  assert.equal(formatWeightDelta(-1.3, 'metric'), '-1.3 kg');
  assert.equal(formatWeightDelta(1.3, 'metric'), '+1.3 kg');
  assert.match(formatWeightDelta(-1.3, 'imperial'), /^-2\.9 lb$/);
});

test('habit tallies count days met across the week, not today', async () => {
  const { habitTally } = await import('../src/lib/selectors');
  const dates = ['2026-09-14', '2026-09-15', '2026-09-16'];
  const targets = { calories: 2100, protein: 100, carbs: 200, fat: 65, fibre: 29, water: 8, steps: 8000 };

  const meal = (date: string, protein: number) => ({
    id: `${date}-${protein}`, date, time: '12:00', slot: 'lunch' as const, title: 'Test',
    items: [], nutrients: { calories: 700, protein, carbs: 60, fat: 20, fibre: 8 }, score: 75, source: 'manual' as const,
  });

  // Protein target met on two of the three days; water on one.
  const meals = [meal('2026-09-14', 100), meal('2026-09-15', 100), meal('2026-09-16', 10)];
  const days = { '2026-09-14': { date: '2026-09-14', water: 8, steps: 0 } };

  const tally = habitTally(meals, days, targets, dates);
  assert.equal(tally.protein, 2, 'two days cleared the protein target');
  assert.equal(tally.water, 1, 'only one day hit the water target');
  assert.equal(tally.movement, 0);
  assert.equal(tally.meals, 0, 'one meal a day is not three');

  // And an empty week tallies zero rather than throwing.
  assert.deepEqual(habitTally([], {}, targets, dates), { meals: 0, protein: 0, water: 0, movement: 0 });
});

test('a weight typed in stones and pounds survives being stored and read back', () => {
  // One decimal place of a kilogram is 0.22 lb — coarser than the field
  // accepts — so whole pounds used to come back a tenth light: 10 lb as 9.9.
  for (const [stone, pounds] of [
    [10, 10],
    [12, 3],
    [9, 7],
    [10, 0],
    [13, MAX_POUNDS_IN_STONE],
  ] as const) {
    assert.deepEqual(
      kgToStonePounds(stonePoundsToKg(stone, pounds)),
      { stone, pounds },
      `${stone} st ${pounds} lb did not survive the round trip`,
    );
  }
});

test('setup starts people on a round number in whichever system they read', () => {
  assert.deepEqual(kgToStonePounds(STARTING_WEIGHTS.imperial.weightKg), { stone: 10, pounds: 10 });
  assert.deepEqual(kgToStonePounds(STARTING_WEIGHTS.imperial.targetWeightKg), { stone: 10, pounds: 0 });
  assert.equal(STARTING_WEIGHTS.metric.weightKg, 68);
});

test('pace is offered in the units being read, not always in kilos', () => {
  assert.equal(formatPace(0.5, 'metric'), '0.5 kg');
  assert.equal(formatPace(0.5, 'imperial'), '1 lb');
  assert.equal(formatPace(paceToKg(1.5, 'imperial'), 'imperial'), '1.5 lb');
});

test('switching units leaves a weight someone typed alone', () => {
  const typed = { units: 'metric' as const, weightKg: 81.4, targetWeightKg: 76, pace: 0.5 };
  const switched = retuneForUnits(typed, 'imperial');
  assert.equal(switched.weightKg, 81.4, 'their own weight must not be altered by a display choice');
  assert.equal(switched.targetWeightKg, 76);
});

test('switching units re-rounds a starting weight nobody has touched', () => {
  const untouched = {
    units: 'metric' as const,
    weightKg: STARTING_WEIGHTS.metric.weightKg,
    targetWeightKg: STARTING_WEIGHTS.metric.targetWeightKg,
    pace: 0.5,
  };
  const switched = retuneForUnits(untouched, 'imperial');
  assert.deepEqual(kgToStonePounds(switched.weightKg), { stone: 10, pounds: 10 });
  assert.equal(formatPace(switched.pace, 'imperial'), '1 lb');
  // And back again, without drifting somewhere odd.
  assert.equal(retuneForUnits(switched, 'metric').weightKg, 68);
});

test('a glass has a stated size, because "10 glasses" on its own means nothing', () => {
  assert.equal(GLASS_ML, 250);
  assert.equal(waterVolume(4), '1 L');
  assert.equal(waterVolume(3), '750 ml');
  assert.equal(waterVolume(10), '2.5 L');
});

test('both systems accept the same span, so switching never clamps a weight away', () => {
  // The smallest and largest a person can enter in stones must be enterable in
  // kilograms too, or switching units quietly rewrites what they recorded.
  const lightest = stonePoundsToKg(STONE_RANGE.min, 0);
  const heaviest = stonePoundsToKg(STONE_RANGE.max, MAX_POUNDS_IN_STONE);
  assert.ok(lightest >= WEIGHT_KG_RANGE.min, `${lightest} kg is below the metric field's floor`);
  assert.ok(heaviest <= WEIGHT_KG_RANGE.max, `${heaviest} kg is above the metric field's ceiling`);
});

test('the same holds for height', () => {
  const shortest = feetInchesToCm(FEET_RANGE.min, 0);
  const tallest = feetInchesToCm(FEET_RANGE.max, 11);
  assert.ok(shortest >= HEIGHT_CM_RANGE.min, `${shortest} cm is below the metric field's floor`);
  assert.ok(tallest <= HEIGHT_CM_RANGE.max, `${tallest} cm is above the metric field's ceiling`);
});

test('salt is shown as salt, not sodium wearing its name', () => {
  // A gram of salt is only about 0.4 g of sodium, so the two are not
  // interchangeable: 2300 mg of sodium is 5.8 g of salt, near the NHS 6 g.
  assert.equal(saltGrams(2300), 5.8);
  assert.equal(saltGrams(1040), 2.6);
  assert.equal(saltGrams(0), 0);
});

test('a salt limit set in grams is stored back as sodium', () => {
  assert.equal(sodiumMg(6), 2400);
  assert.equal(saltGrams(sodiumMg(6)), 6);
  assert.equal(saltGrams(sodiumMg(2.5)), 2.5);
});
