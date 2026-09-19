import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KCAL_PER_KG, MAX_SHIFT_DOWN, MAX_SHIFT_UP, adaptiveSuggestion, observe, suggest } from '../src/lib/adaptive';
import { baseTdee, bmr, computeTargets } from '../src/lib/nutrition';
import type { DayLog, MealEntry, Profile } from '../src/types';

const TODAY = '2026-09-19';
const day = (n: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const PERSON: Profile = {
  name: 'Mia', sex: 'female', age: 29, heightCm: 168, weightKg: 68, targetWeightKg: 63,
  activity: 'light', goal: 'lose', pace: 0.5, units: 'metric', onboarded: true,
};

/** A month of honest logging: `kcal` a day, and a weight moving `kgPerWeek`. */
const history = (options: { kcal: number; kgPerWeek: number; days?: number; startKg?: number; weighEvery?: number }) => {
  const { kcal, kgPerWeek, days = 28, startKg = 70, weighEvery = 3 } = options;
  const meals: MealEntry[] = [];
  const logs: Record<string, DayLog> = {};

  for (let ago = days - 1; ago >= 0; ago--) {
    const date = day(ago);
    const elapsed = days - 1 - ago;
    meals.push({
      id: `m${ago}`, date, time: '13:00', slot: 'lunch', title: 'A day', source: 'search', score: 70,
      items: [], nutrients: { calories: kcal, protein: 90, carbs: 180, fat: 60, fibre: 20, sugar: 40, sodium: 1800 },
    } as MealEntry);
    if (elapsed % weighEvery === 0 || ago === 0) {
      logs[date] = { date, water: 6, steps: 7000, weightKg: startKg + (kgPerWeek * elapsed) / 7 };
    }
  }
  return { meals, days: logs };
};

test('says nothing at all without enough to go on', () => {
  assert.equal(adaptiveSuggestion(PERSON, [], {}, 1800, TODAY), null);

  // Plenty of food logged, but barely any weigh-ins.
  const sparse = history({ kcal: 1800, kgPerWeek: -0.5, weighEvery: 40 });
  assert.equal(observe(sparse.meals, sparse.days, 1800, 28, TODAY), null, 'four weigh-ins is the minimum');

  // Weighed often, but only a handful of days actually logged.
  const thin = history({ kcal: 1800, kgPerWeek: -0.5, days: 8 });
  assert.equal(observe(thin.meals, thin.days, 1800, 28, TODAY), null, 'ten logged days is the minimum');
});

test('recovers a burn rate that energy balance can be checked against', () => {
  // Eat 1800, lose 0.5 kg a week ⇒ burning 1800 + (0.5 × 7700 / 7) ≈ 2350.
  const { meals, days } = history({ kcal: 1800, kgPerWeek: -0.5 });
  const seen = observe(meals, days, 1800, 28, TODAY);
  assert.ok(seen, 'a month of clean data should be enough');
  assert.equal(seen.meanIntake, 1800);
  assert.ok(Math.abs(seen.weeklyChangeKg - -0.5) < 0.01, `weekly change read as ${seen.weeklyChangeKg}`);
  const expected = 1800 + (0.5 * KCAL_PER_KG) / 7;
  assert.ok(Math.abs(seen.burn - expected) < 15, `burn read as ${seen.burn}, expected about ${Math.round(expected)}`);
});

test('holding steady means intake is maintenance', () => {
  const { meals, days } = history({ kcal: 2100, kgPerWeek: 0 });
  const seen = observe(meals, days, 2100, 28, TODAY)!;
  assert.equal(seen.weeklyChangeKg, 0);
  assert.equal(seen.burn, 2100);
});

test('a half-logged day is left out rather than dragging the average down', () => {
  const { meals, days } = history({ kcal: 2000, kgPerWeek: 0 });
  // Replace one whole day with a day on which they logged only a coffee.
  const thin = meals.filter((m) => m.date !== day(5));
  thin.push({
    id: 'crumb', date: day(5), time: '09:00', slot: 'breakfast', title: 'Coffee', source: 'search', score: 50,
    items: [], nutrients: { calories: 20, protein: 1, carbs: 2, fat: 1, fibre: 0, sugar: 2, sodium: 15 },
  } as MealEntry);

  const seen = observe(thin, days, 2000, 28, TODAY)!;
  assert.equal(seen.loggedDays, 27, 'the coffee-only day should not be counted');
  assert.equal(seen.meanIntake, 2000, 'and it must not pull the mean down');

  // Counting it would have read as 1929 a day — a 71 kcal lie about their
  // metabolism, in the direction that cuts their food.
  assert.notEqual(Math.round((27 * 2000 + 20) / 28), seen.meanIntake);
});

test('never cuts someone more than the cap allows, however the numbers read', () => {
  // The under-logger: claims 1000 a day and is not losing weight, which the
  // raw arithmetic reads as a metabolism of 1000.
  const { meals, days } = history({ kcal: 1000, kgPerWeek: 0 });
  const fix = adaptiveSuggestion(PERSON, meals, days, 1200, TODAY)!;

  assert.ok(fix.observed < 1200, 'the raw reading really is that low');
  assert.ok(fix.capped, 'which is exactly when the cap should bite');
  assert.ok(fix.factor >= 1 - MAX_SHIFT_DOWN - 0.001, `factor fell to ${fix.factor}`);
  assert.ok(fix.applied >= bmr(PERSON), 'maintenance must never fall below basal rate');
});

test('never raises it beyond the cap either', () => {
  const { meals, days } = history({ kcal: 4000, kgPerWeek: -1 });
  const fix = adaptiveSuggestion(PERSON, meals, days, 1800, TODAY)!;
  assert.ok(fix.capped);
  assert.ok(fix.factor <= 1 + MAX_SHIFT_UP + 0.001, `factor rose to ${fix.factor}`);
});

test('believes the data more the more of it there is', () => {
  const thorough = history({ kcal: 1700, kgPerWeek: -0.6, weighEvery: 2 });
  const patchy = history({ kcal: 1700, kgPerWeek: -0.6, days: 16, weighEvery: 4 });

  const a = observe(thorough.meals, thorough.days, 1700, 28, TODAY)!;
  const b = observe(patchy.meals, patchy.days, 1700, 28, TODAY)!;
  assert.ok(a.confidence > b.confidence, `${a.confidence} should beat ${b.confidence}`);

  // And a lower-confidence reading moves the target less.
  const moveA = Math.abs(suggest(PERSON, a)!.applied - baseTdee(PERSON));
  const moveB = Math.abs(suggest(PERSON, b)!.applied - baseTdee(PERSON));
  assert.ok(moveA > moveB, 'thin evidence should shift things less');
});

test('stays quiet when the formula was already about right', () => {
  const burn = baseTdee(PERSON);
  // Eating at maintenance and holding steady: the formula had it right.
  const { meals, days } = history({ kcal: Math.round(burn), kgPerWeek: 0 });
  assert.equal(adaptiveSuggestion(PERSON, meals, days, Math.round(burn), TODAY), null);
});

test('the same evidence gives the same answer, whatever is already applied', () => {
  // The reading is always taken against the untouched formula, so adjustments
  // land on the same number instead of ratcheting away from it.
  const { meals, days } = history({ kcal: 1800, kgPerWeek: -0.25 });
  const fresh = suggest(PERSON, observe(meals, days, 1800, 28, TODAY))!;
  const alreadyTuned = suggest({ ...PERSON, burnFactor: 1.15 }, observe(meals, days, 1800, 28, TODAY))!;

  assert.equal(alreadyTuned.applied, fresh.applied, 'a second look must not stack on the first');
  assert.equal(alreadyTuned.formula, fresh.formula, 'the baseline is the formula, not the tuned figure');
});

test('the safe floor still applies to the target it produces', () => {
  const slow: Profile = { ...PERSON, weightKg: 45, heightCm: 150, age: 60, pace: 1 };
  const targets = computeTargets({ ...slow, burnFactor: 0.9 });
  assert.ok(targets.calories >= 1200, `a woman should never be sent below 1200, got ${targets.calories}`);
});

test('a stored factor beyond the cap is ignored rather than obeyed', () => {
  const tampered: Profile = { ...PERSON, burnFactor: 0.2 };
  assert.equal(computeTargets(tampered).calories, computeTargets({ ...PERSON, burnFactor: 0.9 }).calories);
});

test('it will not cut as deeply as it will raise', () => {
  // The same evidence, read in each direction. Down is held on a shorter rein
  // because "you burn less than we thought" is usually a gappy food diary.
  const low = adaptiveSuggestion(PERSON, ...Object.values(history({ kcal: 900, kgPerWeek: 0 })) as [MealEntry[], Record<string, DayLog>], 1200, TODAY)!;
  const high = adaptiveSuggestion(PERSON, ...Object.values(history({ kcal: 4500, kgPerWeek: -1 })) as [MealEntry[], Record<string, DayLog>], 1800, TODAY)!;

  assert.ok(1 - low.factor < high.factor - 1, 'the cut must be the smaller of the two');
  assert.ok(1 - low.factor <= MAX_SHIFT_DOWN + 0.001);
  assert.ok(high.factor - 1 <= MAX_SHIFT_UP + 0.001);
});

test('stops offering once the offer has been taken', () => {
  const { meals, days } = history({ kcal: 1800, kgPerWeek: -0.5 });
  const offer = adaptiveSuggestion(PERSON, meals, days, 1410, TODAY)!;
  assert.ok(offer, 'there should be something to offer first');

  const after: Profile = { ...PERSON, burnFactor: offer.factor };
  assert.equal(adaptiveSuggestion(after, meals, days, 1410, TODAY), null, 'it must not keep asking');
});

test('speaks up again if the evidence later moves', () => {
  const settled: Profile = { ...PERSON, burnFactor: 1.15 };
  // Their logs now point somewhere quite different from what they are on.
  const { meals, days } = history({ kcal: 1600, kgPerWeek: -0.1 });
  const offer = adaptiveSuggestion(settled, meals, days, 1410, TODAY);
  assert.ok(offer, 'a real change in the data deserves a new offer');
  assert.ok(Math.abs(offer.factor - 1.15) >= 0.03);
});
