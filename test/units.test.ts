import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_POUNDS_IN_STONE,
  cmToFeetInches,
  feetInchesToCm,
  formatHeight,
  formatWeight,
  formatWeightDelta,
  kgToPounds,
  kgToStonePounds,
  poundsToKg,
  stonePoundsToKg,
} from '../src/lib/units';

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
