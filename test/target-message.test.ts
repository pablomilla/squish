import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paceTier, targetMessage } from '../src/lib/targetMessage';
import type { Profile } from '../src/types';

/**
 * The "realistic goal" moment says something different for a small goal, a
 * typical one, a big one, a rushed one and one below a healthy weight —
 * and for building up rather than losing.
 */
const base: Profile = {
  name: '', sex: 'female', age: 35, heightCm: 168, weightKg: 80, targetWeightKg: 72,
  activity: 'light', goal: 'lose', pace: 0.5, units: 'metric', onboarded: false,
};
const when = new Date(2027, 1, 1);
const say = (patch: Partial<Profile>) => {
  const p = { ...base, ...patch };
  const weeks = Math.abs(p.weightKg - p.targetWeightKg) / p.pace;
  return targetMessage(p, weeks, when);
};

test('a typical goal is called realistic, with its timescale', () => {
  const m = say({});
  assert.equal(m.kind, 'realistic');
  assert.match(m.headline, /Losing 8 kg is a realistic goal/);
  assert.match(m.detail, /0\.5 kg a week, that is about 16 weeks/);
  assert.match(m.footer, /first 5% — 4 kg/);
});

test('a small goal is very doable, and not given the 5% line it is under', () => {
  const m = say({ targetWeightKg: 77 });
  assert.equal(m.kind, 'small');
  assert.match(m.headline, /Losing 3 kg is very doable/);
  assert.match(m.footer, /Steady is what lasts/);
});

test('a big goal is reachable in stages, with a first milestone', () => {
  const m = say({ weightKg: 110, targetWeightKg: 80 });
  assert.equal(m.kind, 'big');
  assert.match(m.headline, /30 kg is a big goal — and a reachable one/);
  assert.match(m.detail, /first milestone is 104\.5 kg, about 11 weeks away/);
});

test('a goal years away is said in years', () => {
  const m = say({ weightKg: 150, targetWeightKg: 80, pace: 0.3 });
  assert.equal(m.kind, 'big');
  assert.match(m.detail, /about 4\.5 years — a long road/);
});

test('a fast pace is called ambitious rather than realistic', () => {
  const m = say({ pace: 1 });
  assert.equal(m.kind, 'fast');
  assert.match(m.headline, /Losing 8 kg by .+ is ambitious/);
  assert.match(m.detail, /a notch slower tends to last/);
});

test('a goal below a healthy weight is not called realistic, however it is paced', () => {
  const m = say({ weightKg: 60, targetWeightKg: 50, pace: 1 });
  assert.equal(m.kind, 'low');
  assert.match(m.headline, /aim a little higher/);
});

test('building up has its own words', () => {
  const typical = say({ goal: 'gain', weightKg: 60, targetWeightKg: 65, pace: 0.25 });
  assert.match(typical.headline, /Gaining 5 kg is a realistic goal/);
  assert.match(typical.footer, /protein and some strength work/);
  const quick = say({ goal: 'gain', weightKg: 60, targetWeightKg: 65, pace: 0.6 });
  assert.equal(quick.kind, 'fast');
  assert.match(quick.detail, /mostly adds fat/);
  // A low goal weight is a losing problem, not a gaining one.
  assert.notEqual(say({ goal: 'gain', weightKg: 45, targetWeightKg: 50, pace: 0.25 }).kind, 'low');
});

test('gaining is fast sooner than losing', () => {
  assert.equal(paceTier(0.6, 'lose'), 'brisk');
  assert.equal(paceTier(0.6, 'gain'), 'fast');
});
