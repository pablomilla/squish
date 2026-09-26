import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentPlace, inPlace, placeFrom, regionNote } from '../server/region';
import { chatRequest } from '../server/chat';
import { WEEKPLAN_SYSTEM } from '../server/weekplan';
import { SYSTEM } from '../server/claude';
import { SODIUM_LIMIT, computeTargets, microTargets } from '../src/lib/nutrition';
import { DEFAULT_PROFILE } from '../src/store/useSquish';

/**
 * The prompts, country by country: what a person in Sydney or Ohio is told
 * differs only in words and units, never in what the JSON means.
 */
test('the headers are trusted for nothing: an unknown region is Britain', () => {
  assert.deepEqual(placeFrom('AU', undefined), { region: 'AU', energy: 'kJ', language: 'en' });
  assert.deepEqual(placeFrom('AU', 'kcal'), { region: 'AU', energy: 'kcal', language: 'en' });
  assert.deepEqual(placeFrom('ZZ', 'joules'), { region: 'GB', energy: 'kcal', language: 'en' });
  assert.deepEqual(placeFrom(undefined, undefined), { region: 'GB', energy: 'kcal', language: 'en' });
  assert.equal(currentPlace().region, 'GB', 'outside a request');
});

test('the shared rules no longer speak only British', () => {
  for (const prompt of [SYSTEM, WEEKPLAN_SYSTEM]) assert.doesNotMatch(prompt, /British (English|home cooking)/);
});

test('a label is read the way that country prints one', () => {
  const uk = regionNote('label', { region: 'GB', energy: 'kcal', language: 'en' });
  const us = regionNote('label', { region: 'US', energy: 'kcal', language: 'en' });
  const au = regionNote('label', { region: 'AU', energy: 'kJ', language: 'en' });
  assert.match(uk, /SALT in grams/);
  assert.match(us, /Total Carbohydrate" already includes dietary fiber/);
  assert.match(us, /Added Sugars/);
  assert.match(au, /divide the kJ by 4\.184/);
  // Whatever the country, the numbers come back in one unit.
  for (const note of [uk, us, au]) assert.match(note, /calories in kcal, sodium in milligrams/);
});

test('the nutritionist talks in kJ and sodium in Australia, kcal and salt in Britain', () => {
  const au = regionNote('chat', { region: 'AU', energy: 'kJ', language: 'en' });
  assert.match(au, /Australian English/);
  assert.match(au, /kilojoules/);
  assert.match(au, /sodium in mg/);
  assert.match(au, /Australian Dietary Guidelines/);
  const gb = regionNote('chat', { region: 'GB', energy: 'kcal', language: 'en' });
  assert.match(gb, /British English/);
  assert.match(gb, /salt in grams/);
  assert.match(gb, /Eatwell/);
});

test('the chat keeps its cached rules the same for everyone and puts the country after them', () => {
  const context = { profile: 'x', targets: 'y', today: 'z', week: 'w', recentMeals: [] } as never;
  const sydney = inPlace({ region: 'AU', energy: 'kJ', language: 'en' }, () => chatRequest([{ role: 'user', content: 'hi' }], context));
  const leeds = inPlace({ region: 'GB', energy: 'kcal', language: 'en' }, () => chatRequest([{ role: 'user', content: 'hi' }], context));
  const [rulesA, restA] = sydney.system as { text: string }[];
  const [rulesB, restB] = leeds.system as { text: string }[];
  assert.equal(rulesA.text, rulesB.text);
  assert.match(restA.text, /Where they live: Australia/);
  assert.match(restB.text, /Where they live: United Kingdom/);
});

test('a meal plan shops where they live', () => {
  assert.match(regionNote('plan', { region: 'US', energy: 'kcal', language: 'en' }), /American grocery store/);
  assert.match(regionNote('plan', { region: 'NZ', energy: 'kJ', language: 'en' }), /New Zealand supermarket/);
});

test('targets follow each country’s advice', () => {
  assert.equal(computeTargets({ ...DEFAULT_PROFILE }).sodium, SODIUM_LIMIT.uk);
  assert.equal(computeTargets({ ...DEFAULT_PROFILE, region: 'US' }).sodium, 2300);
  assert.equal(computeTargets({ ...DEFAULT_PROFILE, region: 'AU' }).sodium, 2000);
  const woman = { sex: 'female' as const, age: 30 };
  assert.equal(microTargets(woman).iron, 14.8);
  assert.equal(microTargets({ ...woman, region: 'CA' }).iron, 18);
  assert.equal(microTargets({ ...woman, region: 'US' }).vitaminD, 15);
  assert.equal(microTargets({ ...woman, region: 'NZ' }).vitaminC, 45);
  assert.equal(microTargets({ ...woman, age: 60, region: 'AU' }).calcium, 1300);
});
