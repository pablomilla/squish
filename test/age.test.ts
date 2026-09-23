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
  for (const file of ['src/screens/Onboarding.tsx', 'src/screens/You.tsx']) {
    const source = read(file);
    assert.ok(!/label="Age"[^>]*min=\{1[0-7]\}/s.test(source), `${file} still lets a child in`);
    assert.match(source, /min=\{MIN_AGE\}/, `${file} does not use MIN_AGE`);
    assert.match(source, /onBelowMin=/, `${file} rounds a child's age up to 18 without a word`);
  }
});

test('a diary already set up for somebody under 18 is stopped too', () => {
  assert.match(read('src/App.tsx'), /s\.profile\.age < MIN_AGE/);
});

test('the age a child types is not kept', () => {
  const screen = read('src/components/TooYoung.tsx');
  assert.ok(!/localStorage|setProfile|fetch\(/.test(screen), 'the under-18 screen stores or sends something');
});
