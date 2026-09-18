import assert from 'node:assert/strict';
import { test } from 'node:test';
import { limit, wrap } from '../src/lib/cardtext.ts';

/** A stand-in for a real font: every character the same width. */
const measure = (text: string) => text.length * 10;

test('wording that fits stays on one line', () => {
  assert.deepEqual(wrap('9 day streak', 200, measure), ['9 day streak']);
});

test('wording that does not fit breaks on spaces, never mid-word', () => {
  assert.deepEqual(wrap('nine wonderful days in a row', 150, measure), ['nine wonderful', 'days in a row']);
});

test('a single word too wide for the card is left whole rather than split', () => {
  assert.deepEqual(wrap('unputdownable', 60, measure), ['unputdownable']);
});

test('lines within the allowance are left exactly as written', () => {
  assert.deepEqual(limit(['one', 'two'], 2), ['one', 'two']);
});

test('lines beyond the allowance trail off instead of running onto the figures', () => {
  assert.deepEqual(limit(['one', 'two', 'three'], 2), ['one', 'two…']);
});

test('a dropped clause does not leave its comma behind', () => {
  assert.deepEqual(limit(['Twelve days logged,', 'averaging 1840 kcal,', 'and rising'], 2), [
    'Twelve days logged,',
    'averaging 1840 kcal…',
  ]);
});
