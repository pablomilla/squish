import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { STEP_ACTIONS, detailsFor, guessDetail, usedIn, type StepDetail } from '../src/lib/cooking';
import { COOK_SCHEMA, COOK_SYSTEM, toCookSteps } from '../server/cook';

/**
 * Cook mode's pictures and timers: the model labels each step with what it
 * does and how long to wait, whatever the language; steps from before it did
 * are read from their words; and each step shows the foods it names.
 */
test('the model is asked for an action and a timer for every step, from a fixed list', () => {
  assert.deepEqual(COOK_SCHEMA.required, ['minutes', 'steps', 'actions', 'timers', 'tip']);
  assert.ok(COOK_SCHEMA.properties.actions.items.enum.includes('boil'));
  assert.match(COOK_SYSTEM, /"simmer for 10–12 minutes" is 12/);
});

test('its labels are kept only when there is one for every step', () => {
  const steps = ['Chop the onion.', 'Simmer for 10 minutes.', 'Serve.'];
  assert.deepEqual(toCookSteps({ minutes: 20, steps, actions: ['prep', 'boil', 'serve'], timers: [0, 10, 0], tip: '' }).detail, [
    { action: 'prep' }, { action: 'boil', minutes: 10 }, { action: 'serve' },
  ]);
  assert.equal(toCookSteps({ minutes: 20, steps, actions: ['prep', 'boil'], timers: [0, 10], tip: '' }).detail, undefined, 'one short: none at all');
  assert.equal(toCookSteps({ minutes: 20, steps, actions: ['prep', 'juggle', 'serve'], timers: [0, 0, 0], tip: '' }).detail, undefined, 'an action not on the list');
  assert.deepEqual(toCookSteps({ minutes: 20, steps, actions: ['prep', 'boil', 'serve'], timers: [0, 999, -2], tip: '' }).detail?.map((d) => d.minutes), [undefined, undefined, undefined], 'a timer that cannot be true');
});

test('a step written before the labels is read from its words, timer and all', () => {
  assert.deepEqual(guessDetail('Bring a pan of water to the boil and simmer the rice for 10–12 minutes.'), { action: 'boil', minutes: 12 });
  assert.deepEqual(guessDetail('Bake at 200°C for 25 minutes.'), { action: 'bake', minutes: 25 });
  assert.deepEqual(guessDetail('Finely chop the onion.'), { action: 'prep' });
  assert.deepEqual(guessDetail('Plate up and enjoy.'), { action: 'serve' });
  assert.deepEqual(guessDetail('Something unusual.'), { action: 'prep' }, 'a guess, never nothing');
  const steps = ['Chop it.', 'Fry it for 5 minutes.'];
  assert.deepEqual(detailsFor(steps, [{ action: 'mix' }, { action: 'fry', minutes: 5 }]), [{ action: 'mix' }, { action: 'fry', minutes: 5 }], 'the model’s labels first');
  assert.deepEqual(detailsFor(steps), [{ action: 'prep' }, { action: 'fry', minutes: 5 }]);
});

test('a step shows the foods it names, by any particular word of their name', () => {
  const items = [{ name: 'Basmati rice' }, { name: 'Red pepper' }, { name: 'Salmon fillet' }, { name: 'Fresh basil' }, { name: 'Tinned chopped tomatoes' }];
  const names = (step: string) => usedIn(step, items).map((i) => i.name);
  assert.deepEqual(names('Simmer the rice for 12 minutes.'), ['Basmati rice']);
  assert.deepEqual(names('Fry the peppers and the salmon.'), ['Red pepper', 'Salmon fillet'], 'plurals too');
  assert.deepEqual(names('Add the tomatoes.'), ['Tinned chopped tomatoes']);
  assert.deepEqual(names('Use fresh water.'), [], '"fresh" alone is not basil');
  assert.deepEqual(names('Price it up.'), [], 'a word inside another word is not the food');
  assert.deepEqual(usedIn('Añade el arroz basmati.', [{ name: 'arroz basmati' }]).length, 1, 'in any language the steps are written in');
});

test('every kind of step has its picture', () => {
  for (const action of STEP_ACTIONS) {
    assert.ok(existsSync(new URL(`../src/assets/cook/${action}.webp`, import.meta.url)), `src/assets/cook/${action}.webp`);
  }
});

test('a sauce simmering where the meat was browned shows the frying pan, not the pasta pot', () => {
  const items = [{ name: 'Wholewheat spaghetti' }, { name: 'Turkey mince' }, { name: 'Chopped tomatoes' }, { name: 'Onion' }];
  const steps = [
    'Boil the spaghetti for 10 minutes.',
    'Fry the onion and turkey mince until browned.',
    'Add the chopped tomatoes to the turkey and simmer for 10 minutes.',
    'Let the sauce bubble for 2 minutes more.',
    'Drain the spaghetti and simmer it in the pot for a minute.',
  ];
  const labelled: StepDetail[] = [{ action: 'boil', minutes: 10 }, { action: 'fry' }, { action: 'boil', minutes: 10 }, { action: 'boil', minutes: 2 }, { action: 'boil' }];
  assert.deepEqual(detailsFor(steps, labelled, items).map((d) => d.action), ['boil', 'fry', 'fry', 'fry', 'boil']);
  assert.equal(detailsFor(steps, labelled, items)[2].minutes, 10, 'the timer stays');
  assert.deepEqual(detailsFor(steps, undefined, items).map((d) => d.action), ['boil', 'fry', 'fry', 'fry', 'boil'], 'guessed from the words too');
  assert.deepEqual(detailsFor(steps, labelled).map((d) => d.action), ['boil', 'fry', 'boil', 'boil', 'boil'], 'as labelled without the ingredients');
  // Rice boiled then fried moves to the pan, as the model said: only simmering follows the food.
  assert.deepEqual(detailsFor(['Boil the rice.', 'Fry the rice with the egg.'], [{ action: 'boil' }, { action: 'fry' }], [{ name: 'Rice' }, { name: 'Egg' }]).map((d) => d.action), ['boil', 'fry']);
});

test('the model is told a picture follows the food', () => {
  assert.match(COOK_SYSTEM, /follow the food/);
  assert.match(COOK_SYSTEM, /pan something was fried in is still fry/);
});
