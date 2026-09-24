import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { equivalentFor, mealEquivalent, progressWords, seedFrom } from '../src/lib/equivalents';

/** "The protein of 3 eggs": comparisons for the good things, from the app's own food table. */

test('the protein of about three eggs', () => {
  // An egg is 55 g at 13 g per 100 g: 7.15 g. 21 g is three of them.
  const eggs = equivalentFor('protein', 21, 0);
  assert.deepEqual(eggs, { nutrient: 'protein', emoji: '🥚', amount: '3 eggs' });
});

test('halves while the numbers are small, and one is singular', () => {
  assert.equal(equivalentFor('protein', 7.2, 0)?.amount, '1 egg');
  assert.equal(equivalentFor('protein', 10.7, 0)?.amount, '1½ eggs');
  assert.equal(equivalentFor('fibre', 4.4, 0)?.amount, '1 apple');
});

test('too little to compare is nothing, not "0.2 of an apple"', () => {
  assert.equal(equivalentFor('fibre', 1, 0), null);
  assert.equal(equivalentFor('protein', 0, 0), null);
  assert.equal(equivalentFor('protein', Number.NaN, 0), null);
});

test('the food rotates, but only among ones that give a sensible count', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 12; seed++) {
    const e = equivalentFor('protein', 60, seed);
    assert.ok(e);
    const n = Number(e.amount.split(' ')[0].replace('½', '.5'));
    assert.ok(n >= 1 && n <= 8, `${e.amount} is not a sensible count`);
    seen.add(e.emoji);
  }
  assert.ok(seen.size > 1, 'always the same food');
});

test('a huge amount falls back to the biggest food rather than "40 eggs"', () => {
  const e = equivalentFor('protein', 400, 0);
  assert.match(e?.amount ?? '', /chicken breasts$/);
});

test('a meal gets whichever good thing it has most of, against the day', () => {
  const lentilSoup = mealEquivalent({ protein: 12, fibre: 14 }, { protein: 120, fibre: 30 }, 0);
  assert.equal(lentilSoup?.nutrient, 'fibre');
  const chicken = mealEquivalent({ protein: 40, fibre: 2 }, { protein: 120, fibre: 30 }, 0);
  assert.equal(chicken?.nutrient, 'protein');
  assert.equal(mealEquivalent({ protein: 1, fibre: 0.5 }, { protein: 120, fibre: 30 }, 0), null);
});

test('kind words for how far along the day is', () => {
  assert.equal(progressWords(10, 30), '');
  assert.equal(progressWords(24, 30), ' — nearly there');
  assert.equal(progressWords(31, 30), ' — that’s your target!');
});

test('the same day always gets the same food', () => {
  assert.equal(seedFrom('2026-09-24'), seedFrom('2026-09-24'));
  assert.notEqual(seedFrom('2026-09-24'), seedFrom('2026-09-25'));
});

test('never calories, never a treat', () => {
  const source = readFileSync('src/lib/equivalents.ts', 'utf8');
  assert.ok(!/calories\b.*=|'calories'|doughnut|donut|chocolate/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')), 'comparisons have crept into energy or treats');
});
