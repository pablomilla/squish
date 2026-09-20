import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OVER,
  WAY_OVER,
  dayVerdict,
  isCeiling,
  overPhrase,
  overTargets,
  scoreLabel,
} from '../src/lib/nutrition';
import type { Nutrients, Targets } from '../src/types';

const TARGETS: Targets = {
  calories: 2000, protein: 120, carbs: 200, fat: 65, fibre: 28,
  sugar: 50, sodium: 2300, water: 8, steps: 8000,
};

const day = (over: Partial<Nutrients> = {}): Nutrients => ({
  calories: 2000, protein: 110, carbs: 180, fat: 60, fibre: 25, sugar: 40, sodium: 1800, ...over,
});

test('the day the user reported: 190 g of fat against 65 g is not a balanced day', () => {
  const totals = day({ fat: 190 });
  const score = 62; // What the composition score says, and used to be the whole story.

  assert.equal(scoreLabel(score).label, 'Balanced', 'the score itself has not moved');

  const verdict = dayVerdict(score, totals, TARGETS);
  assert.equal(verdict.label, 'Over on fat');
  assert.equal(verdict.tone, 'bad');
  assert.equal(verdict.over[0].key, 'fat');
});

test('a day inside its targets reads exactly as it did before', () => {
  const verdict = dayVerdict(62, day(), TARGETS);
  assert.equal(verdict.label, 'Balanced');
  assert.equal(verdict.tone, 'good');
  assert.deepEqual(verdict.over, []);
});

test('nothing logged still says nothing logged, targets or no targets', () => {
  const verdict = dayVerdict(0, day({ fat: 190 }), TARGETS);
  assert.equal(verdict.tone, 'none');
});

test('a quarter over is flagged but does not overrule the score', () => {
  const totals = day({ fat: Math.round(65 * 1.3) });
  const verdict = dayVerdict(80, totals, TARGETS);

  assert.equal(verdict.label, 'Brilliant', 'a little over is worth showing, not worth shouting');
  assert.equal(verdict.over.length, 1);
  assert.equal(verdict.over[0].level, 'over');
});

test('only the ceilings count — eating plenty of protein is not a warning', () => {
  assert.deepEqual(overTargets(day({ protein: 300, fibre: 90 }), TARGETS), []);
  assert.equal(isCeiling('fat'), true);
  assert.equal(isCeiling('carbs'), true);
  assert.equal(isCeiling('protein'), false);
  assert.equal(isCeiling('fibre'), false);
});

test('sugar and salt are ceilings too', () => {
  const salty = overTargets(day({ sodium: 6000 }), TARGETS);
  assert.equal(salty[0].key, 'sodium');

  const sweet = overTargets(day({ sugar: 160 }), TARGETS);
  assert.equal(sweet[0].key, 'sugar');
  assert.equal(dayVerdict(70, day({ sugar: 160 }), TARGETS).label, 'Over on sugar');
});

test('the worst offender is the one named', () => {
  const totals = day({ fat: 100, sugar: 200 }); // 1.5x fat, 4x sugar.
  const flags = overTargets(totals, TARGETS);

  assert.equal(flags.length, 2);
  assert.equal(flags[0].key, 'sugar', 'sorted worst first');
  assert.equal(dayVerdict(50, totals, TARGETS).label, 'Over on sugar');
});

test('the thresholds are where they say they are', () => {
  const justUnder = overTargets(day({ fat: 65 * OVER - 0.01 }), TARGETS);
  assert.deepEqual(justUnder, [], 'under a quarter over says nothing');

  const at = overTargets(day({ fat: 65 * OVER }), TARGETS);
  assert.equal(at[0].level, 'over');

  const loud = overTargets(day({ fat: 65 * WAY_OVER }), TARGETS);
  assert.equal(loud[0].level, 'way-over');
});

test('a target of nought is not something to be over', () => {
  const noLimits = { ...TARGETS, sugar: 0, sodium: 0 };
  assert.deepEqual(overTargets(day({ sugar: 200, sodium: 9000 }), noLimits), []);
});

test('how far over, in words', () => {
  const at = (ratio: number) => overPhrase({ key: 'fat', value: 65 * ratio, target: 65, ratio, level: 'over' });

  assert.equal(at(1.3), '30% over');
  assert.equal(at(190 / 65), 'nearly 3×', 'the reported day, rounded the way a person would say it');
  assert.equal(at(2), '2×');
  assert.equal(at(3.4), 'over 3×');
});
