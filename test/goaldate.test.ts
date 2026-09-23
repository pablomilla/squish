import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aroundWhen, goalProjection } from '../src/lib/goalDate';

const today = new Date(2026, 8, 23);

test('losing 8 kg at half a kilo a week is 16 weeks: January', () => {
  const p = goalProjection({ weightKg: 84, targetWeightKg: 76, goal: 'lose', pace: 0.5 }, today);
  assert.equal(p?.kind, 'date');
  assert.equal(p?.kind === 'date' && p.weeks, 16);
  assert.equal(p?.kind === 'date' && aroundWhen(p.date, today), 'January 2027');
});

test('building up works the same way round', () => {
  const p = goalProjection({ weightKg: 60, targetWeightKg: 63, goal: 'gain', pace: 0.25 }, today);
  assert.equal(p?.kind === 'date' && p.weeks, 12);
});

test('a goal pointing the wrong way is noticed, not planned for', () => {
  assert.deepEqual(goalProjection({ weightKg: 70, targetWeightKg: 75, goal: 'lose', pace: 0.5 }, today), { kind: 'mismatch', suggest: 'gain' });
  assert.deepEqual(goalProjection({ weightKg: 70, targetWeightKg: 65, goal: 'gain', pace: 0.5 }, today), { kind: 'mismatch', suggest: 'lose' });
});

test('already there, staying put, or no pace: no date', () => {
  assert.deepEqual(goalProjection({ weightKg: 70, targetWeightKg: 70.2, goal: 'lose', pace: 0.5 }, today), { kind: 'there' });
  assert.equal(goalProjection({ weightKg: 70, targetWeightKg: 60, goal: 'maintain', pace: 0.5 }, today), null);
  assert.equal(goalProjection({ weightKg: 70, targetWeightKg: 60, goal: 'lose', pace: 0 }, today), null);
});

test('near dates are said as people say them', () => {
  assert.equal(aroundWhen(new Date(2026, 8, 30), today), 'this month');
  assert.equal(aroundWhen(new Date(2026, 9, 20), today), 'next month');
});
