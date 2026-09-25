import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeTargets, tdee } from '../src/lib/nutrition';
import { explainPlan } from '../src/lib/planExplained';
import type { Profile } from '../src/types';

/** The plan card says what maintenance is and how the target follows from it, in the reader's own numbers. */
const base: Profile = {
  name: 'Sam', sex: 'male', age: 40, heightCm: 178, weightKg: 82, targetWeightKg: 76,
  activity: 'light', goal: 'lose', pace: 0.5, units: 'metric', onboarded: true,
} as Profile;

test('losing: maintenance, the gap, and the weekly loss it should give', () => {
  const { summary, how } = explainPlan(base, computeTargets(base));
  const burns = Math.round(tdee(base)).toLocaleString('en-GB');
  assert.match(summary, new RegExp(`burns about ${burns} kcal a day`));
  assert.match(summary, /eat that much and your weight stays where it is/);
  assert.match(summary, /kcal less, which should mean losing about 0\.5 kg a week\.$/);
  assert.deepEqual(how.map((h) => h.label), ['Maintenance', 'Daily target', 'Protein', 'Fibre']);
  assert.match(how[1].words, /minus what your pace needs/);
});

test('staying steady and gaining read the right way round', () => {
  const steady = { ...base, goal: 'maintain' as const };
  assert.match(explainPlan(steady, computeTargets(steady)).summary, /the same, so your weight should hold steady/);
  const gain = { ...base, goal: 'gain' as const, pace: 0.25 };
  assert.match(explainPlan(gain, computeTargets(gain)).summary, /kcal more, which should mean gaining about 0\.2 kg a week/);
});

test('pounds for imperial, and a target set by hand says so', () => {
  const imperial = { ...base, units: 'imperial' as const };
  assert.match(explainPlan(imperial, computeTargets(imperial)).summary, /losing about 1\.1 lb a week/);
  const own = { ...computeTargets(base), calories: 2000 };
  assert.match(explainPlan(base, own).summary, /You set this target yourself\.$/);
});

test('when the safety floor holds the target up, it says the pace will be slower', () => {
  const small = { ...base, sex: 'female' as const, age: 60, heightCm: 150, weightKg: 50, targetWeightKg: 45, activity: 'sedentary' as const, pace: 1 };
  const { summary } = explainPlan(small, computeTargets(small));
  assert.match(summary, /won't suggest less than 1,200 kcal a day, so that's slower than the 1 kg a week you picked/);
});
