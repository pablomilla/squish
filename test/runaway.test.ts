import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repeating } from '../server/runaway';

/** Telling a stuck answer from an honest one — with the runaways Gemini actually produced on Nutrition5k. */

test('a character, or a short pattern, repeated past any honest length', () => {
  assert.equal(repeating(`{"grams": 120.${'0'.repeat(300)}`), '0');
  // Both seen on Nutrition5k: counting 1 to 0 again and again, and 1 to 9 again and again.
  assert.equal(repeating(`{"fat": 6.${'1234567890'.repeat(40)}`)?.length, 10);
  assert.ok(repeating(`{"fat": 6.${'123456789'.repeat(40)}`));
  assert.ok(repeating(`{"a": 1${' '.repeat(250)}`), 'padding');
});

test('an honest answer is left alone', () => {
  const meal = JSON.stringify({ title: 'Porridge', items: Array.from({ length: 12 }, (_, i) => ({ name: `Food ${i}`, grams: 120, calories: 150.5 })) });
  assert.equal(repeating(meal), null);
  assert.equal(repeating(`{"note": "${'ha'.repeat(20)}"}`), null, 'a short repeat is not a runaway');
  assert.equal(repeating(''), null);
});
