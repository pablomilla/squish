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

test('changing a birthday on You cannot make somebody under 18, and says so rather than quietly adjusting it', () => {
  const source = read('src/screens/You.tsx');
  assert.match(source, /youngest=\{MIN_AGE\}/, 'the year wheel on You offers years that make a child');
  assert.match(source, /if \(age < MIN_AGE\) \{\s*toast\(/, 'a date in the last year that still makes them 17 is not refused with a word');
});

test('onboarding asks for a birthday, and a child’s stops at the reason rather than going on', () => {
  const source = read('src/screens/Onboarding.tsx');
  assert.match(source, /step === 'born' && draft\.age < MIN_AGE\) \{\s*setTooYoung\(true\)/);
  // Years run to this one, so the truth can be told rather than a year made up.
  const dials = read('src/components/Dials.tsx');
  assert.match(dials, /length: 101 - youngest \}, \(_, i\) => \(\{ value: thisYear - 100 \+ i/);
  assert.match(dials, /youngest = 0,/, 'onboarding would stop the years short of this one');
  assert.doesNotMatch(read('src/screens/Onboarding.tsx'), /<BirthdayWheel[^>]*youngest=/s, 'onboarding stops the years short of this one');
});

test('a diary already set up for somebody under 18 is stopped too', () => {
  assert.match(read('src/App.tsx'), /s\.profile\.age < MIN_AGE/);
});

test('the age a child types is not kept', () => {
  const screen = read('src/components/TooYoung.tsx');
  assert.ok(!/localStorage|setProfile|fetch\(/.test(screen), 'the under-18 screen stores or sends something');
});
