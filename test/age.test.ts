import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * Squish is for adults. These check the pieces that make that true stay in
 * place — the behaviour itself was proved in a browser, as there is no DOM here.
 */
const read = (file: string) => readFileSync(file, 'utf8');

test('the minimum age is 18', () => {
  assert.match(read('src/store/useSquish.ts'), /export const MIN_AGE = 18;/);
});

test('every age field uses it, and says so rather than quietly rounding up', () => {
  const source = read('src/screens/You.tsx');
  assert.ok(!/label="Age"[^>]*min=\{1[0-7]\}/s.test(source), 'You still lets a child in');
  assert.match(source, /min=\{MIN_AGE\}/, 'You does not use MIN_AGE');
  assert.match(source, /onBelowMin=/, "You rounds a child's age up to 18 without a word");
});

test('onboarding asks for a birthday, and a child’s stops at the reason rather than going on', () => {
  const source = read('src/screens/Onboarding.tsx');
  assert.match(source, /step === 'born' && draft\.age < MIN_AGE\) \{\s*setTooYoung\(true\)/);
  // Years run to this one, so the truth can be told rather than a year made up.
  assert.match(read('src/components/Dials.tsx'), /length: 101 \}, \(_, i\) => \(\{ value: thisYear - 100 \+ i/);
});

test('a diary already set up for somebody under 18 is stopped too', () => {
  assert.match(read('src/App.tsx'), /s\.profile\.age < MIN_AGE/);
});

test('the age a child types is not kept', () => {
  const screen = read('src/components/TooYoung.tsx');
  assert.ok(!/localStorage|setProfile|fetch\(/.test(screen), 'the under-18 screen stores or sends something');
});
