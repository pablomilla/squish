import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { AWAITING_PICTURES, STEP_ACTIONS, detailsFor, guessDetail, usedIn, type StepAction, type StepDetail } from '../src/lib/cooking';
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
  assert.deepEqual(guessDetail('Something unusual.'), { action: 'other' }, 'nothing to go on: no picture, not the chopping board');
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

test('every kind of step has its picture, but other and the ones still being painted', () => {
  for (const action of STEP_ACTIONS) {
    const painted = existsSync(new URL(`../src/assets/cook/${action}.webp`, import.meta.url));
    if (action === 'other') assert.ok(!painted, 'other is shown without a picture: the nearest one would be wrong');
    else if (!AWAITING_PICTURES.includes(action)) assert.ok(painted, `src/assets/cook/${action}.webp`);
  }
  // A picture painted is taken off the list, so the test above checks it stays.
  for (const action of AWAITING_PICTURES) {
    assert.ok(!existsSync(new URL(`../src/assets/cook/${action}.webp`, import.meta.url)), `${action} is painted: take it off AWAITING_PICTURES`);
  }
});

test('a protein shake is at the shaker bottle, not in a mixing bowl', () => {
  const items = [{ name: 'Whey protein powder' }, { name: 'Water' }];
  const steps = [
    'Add the 34 g of whey protein powder to a shaker bottle with 250–300 ml of cold water.',
    'Seal and shake hard for 20 seconds until smooth.',
    'Drink straight away.',
  ];
  assert.deepEqual(detailsFor(steps, undefined, items).map((d) => d.action), ['shake', 'shake', 'pour'], 'from the words: and a drink is not on a plate');
  const asLabelled: StepDetail[] = [{ action: 'mix' }, { action: 'mix' }, { action: 'serve' }];
  assert.deepEqual(detailsFor(steps, asLabelled, items).map((d) => d.action), ['shake', 'shake', 'pour'], 'labelled mix the old way: at the bottle from where it is named until it is shaken');
  assert.equal(detailsFor(steps, asLabelled, items)[2].action, 'pour', 'and labelled serve, a drink is still not a plate');
  assert.deepEqual(
    detailsFor(['Put the oats in a shaker.', 'Add the milk.', 'Shake well.', 'Mix the yoghurt and honey in a bowl.'], [{ action: 'mix' }, { action: 'mix' }, { action: 'mix' }, { action: 'mix' }], items).map((d) => d.action),
    ['shake', 'shake', 'shake', 'mix'],
    'and not after it',
  );
  assert.equal(detailsFor(['Añade 30 g de proteína al shaker con 250 ml de agua.'], [{ action: 'mix' }], [{ name: 'proteína' }])[0].action, 'shake', 'in Spanish too');
});

test('the new places, from the words, and not where the words only sound like them', () => {
  const guess = (step: string) => guessDetail(step).action;
  assert.equal(guess('Microwave the porridge for 2 minutes, stirring halfway.'), 'microwave');
  assert.equal(guess('Air fry the chicken at 200°C for 18 minutes.'), 'airfry');
  assert.equal(guess('Put 2 slices of bread in the toaster.'), 'toast');
  assert.equal(guess('Toast the oats in a dry pan for 3 minutes.'), 'fry', 'oats toasted in a pan are in the pan');
  assert.equal(guess('Fry the onion, shaking the pan now and then.'), 'fry');
  assert.equal(guess('Cover and leave in the fridge overnight.'), 'chill');
  assert.equal(guess('Spread the hummus over the wrap and layer the chicken on top.'), 'assemble');
  assert.equal(guess('Pour the milk into a glass.'), 'pour');
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

test('"add the tomatoes and simmer" joins the frying pan, even naming nothing already in it', () => {
  const items = [{ name: 'Wholewheat spaghetti' }, { name: 'Turkey mince' }, { name: 'Chopped tomatoes' }, { name: 'Onion' }, { name: 'Red lentils' }];
  const actions = (steps: string[]) => detailsFor(steps, undefined, items).map((d) => d.action);
  assert.deepEqual(actions(['Boil the spaghetti for 10 minutes.', 'Fry the turkey mince until browned.', 'Add the tomatoes and simmer for 10 minutes.']), ['boil', 'fry', 'fry']);
  assert.deepEqual(actions(['Fry the turkey mince until browned.', 'Boil the spaghetti for 10 minutes.', 'Stir in the chopped tomatoes and simmer for 10 minutes.']), ['fry', 'boil', 'fry'], 'with the pasta boiling in between');
  assert.deepEqual(actions(['Fry the onion.', 'Add the spaghetti and simmer for 10 minutes.']), ['fry', 'boil'], 'pasta goes in the pot');
  assert.deepEqual(actions(['Fry the onion.', 'Add the tomatoes to a pan of boiling water and simmer.']), ['fry', 'boil'], 'when it says the pot, the pot');
  assert.deepEqual(actions(['Fry the onion.', 'Simmer the red lentils in a frying pan with the tomatoes.']), ['fry', 'fry']);
  assert.deepEqual(actions(['Add the tomatoes and simmer for 10 minutes.']), ['boil'], 'with nothing fried, a simmer is the pot');
  const lentils = ['Simmer the red lentils for 20 minutes.', 'Fry the onion.'];
  assert.deepEqual(actions([...lentils, 'Add the lentils to the onion and simmer for 2 minutes.']), ['boil', 'fry', 'fry'], 'where it goes into decides');
  assert.deepEqual(actions([...lentils, 'Tip the onion into the lentils and simmer for 2 minutes.']), ['boil', 'fry', 'boil']);
  assert.deepEqual(actions([...lentils, 'Simmer the lentils for 5 minutes more.']), ['boil', 'fry', 'boil'], 'food in the pot keeps its pot');
});

test('a smoothie is at the blender from the first thing that goes in, not on the chopping board', () => {
  const items = [{ name: 'Frozen mixed berries' }, { name: 'Banana' }, { name: 'Semi-skimmed milk' }, { name: 'Vanilla protein powder' }, { name: 'Rolled oats' }];
  const smoothie = [
    'Add the 150 g of frozen berries to the blender.',
    'Add the banana and the 30 g of oats.',
    'Pour in the 250 ml of milk and add the 30 g of protein powder.',
    'Blend for about a minute until smooth.',
    'Pour into a glass and serve straight away.',
  ];
  // As a model labelling by "the one thing it mostly does" had it: weighing out on the board.
  const labelled: StepDetail[] = [{ action: 'prep' }, { action: 'prep' }, { action: 'mix' }, { action: 'blend', minutes: 1 }, { action: 'serve' }];
  const actions = (steps: string[], detail?: StepDetail[]) => detailsFor(steps, detail, items).map((d) => d.action);
  assert.deepEqual(actions(smoothie, labelled), ['blend', 'blend', 'blend', 'blend', 'serve']);
  assert.equal(detailsFor(smoothie, labelled, items)[3].minutes, 1, 'the timer stays');
  assert.deepEqual(actions(smoothie), ['blend', 'blend', 'blend', 'blend', 'serve'], 'guessed from the words too');

  // Without naming the blender until it is switched on: what goes in just before is going into it.
  assert.deepEqual(actions(['Add the berries and the banana.', 'Pour in the milk.', 'Blitz until smooth.']), ['blend', 'blend', 'blend']);
  // Chopping stays on the board; pouring it out afterwards is pouring, not more blending.
  assert.deepEqual(
    actions(['Peel and slice the banana.', 'Put the banana and berries in the blender.', 'Blend until smooth.', 'Pour into a glass.']),
    ['prep', 'blend', 'blend', 'pour'],
  );
  // A soup blended at the end keeps its pan for the steps that cook it (the stock joins the onion's pan, as before).
  assert.deepEqual(
    actions(['Fry the onion.', 'Add the stock and simmer for 15 minutes.', 'Blend until smooth.'], [{ action: 'fry' }, { action: 'boil', minutes: 15 }, { action: 'blend' }]),
    ['fry', 'fry', 'blend'],
  );
});

test('the model is told that what goes into the blender is blend, and the board is only for the knife', () => {
  assert.match(COOK_SYSTEM, /Putting things into a blender or food processor is blend/);
  assert.match(COOK_SYSTEM, /prep is the knife and board/);
});

test('a smoothie follows its food in other languages too, from the blender’s name and the model’s own labels', () => {
  // As labelled before, by what each step mostly does: the adding on the board, the blending at the blender.
  const actions = (steps: string[], given: StepAction[]) =>
    detailsFor(steps, given.map((action) => ({ action })), [{ name: 'fresas' }]).map((d) => d.action);
  const smoothie: StepAction[] = ['prep', 'prep', 'mix', 'blend', 'serve'];

  assert.deepEqual(actions([
    'Añade 150 g de frutos rojos congelados a la licuadora.',
    'Añade el plátano y 30 g de avena.',
    'Vierte 250 ml de leche y la proteína en polvo.',
    'Tritura durante un minuto hasta que quede suave.',
    'Sírvelo en un vaso.',
  ], smoothie), ['blend', 'blend', 'blend', 'blend', 'serve'], 'Spanish');
  assert.deepEqual(actions(['Añade las fresas y el plátano.', 'Vierte la leche.', 'Tritura hasta que quede suave.'], ['prep', 'prep', 'blend']), ['blend', 'blend', 'blend'], 'Spanish, the blender never named');
  assert.deepEqual(actions(['Pela y corta el plátano.', 'Pon el plátano en la licuadora.', 'Tritura.'], ['prep', 'prep', 'blend']), ['prep', 'blend', 'blend'], 'Spanish chopping stays on the board');
  assert.deepEqual(actions(['Mettez les fruits rouges dans le blender.', 'Ajoutez la banane.', 'Mixez jusqu’à ce que ce soit lisse.'], ['prep', 'prep', 'blend']), ['blend', 'blend', 'blend'], 'French');
  assert.deepEqual(actions(['Gib die Beeren und die Banane in den Mixer.', 'Gieße 250 ml Milch dazu.', 'Püriere alles fein.'], ['prep', 'mix', 'blend']), ['blend', 'blend', 'blend'], 'German');
  assert.deepEqual(actions(['Włóż owoce do blendera.', 'Dodaj mleko.', 'Zmiksuj na gładko.'], ['prep', 'mix', 'blend']), ['blend', 'blend', 'blend'], 'Polish, the blender inflected');
  assert.deepEqual(actions(['把冷冻莓果放入搅拌机。', '加入香蕉和燕麦。', '搅打一分钟至顺滑。'], ['prep', 'prep', 'blend']), ['blend', 'blend', 'blend'], 'Chinese');
  assert.deepEqual(actions(['冷凍ベリーをミキサーに入れる。', '牛乳を加える。', 'なめらかになるまで撹拌する。', 'グラスに注ぐ。'], ['prep', 'mix', 'blend', 'serve']), ['blend', 'blend', 'blend', 'serve'], 'Japanese');
  assert.deepEqual(actions(['ضع التوت في الخلاط.', 'أضف الحليب.', 'اخلط حتى يصبح ناعماً.'], ['prep', 'mix', 'blend']), ['blend', 'blend', 'blend'], 'Arabic, the blender joined to its "the"');
  assert.deepEqual(actions(['बेरी को ब्लेंडर में डालें।', 'दूध डालें।', 'चिकना होने तक ब्लेंड करें।'], ['prep', 'mix', 'blend']), ['blend', 'blend', 'blend'], 'Hindi');

  // Nothing in these is a blender: the words must be whole words, in any script.
  assert.deepEqual(actions(['Add the raspberries and the banana.', 'Blend until smooth.'], ['prep', 'blend']), ['blend', 'blend'], 'raspberries are not grated');
  assert.deepEqual(actions(['Beat the butter and sugar in a stand mixer.', 'Fold in the flour.'], ['mix', 'mix']), ['mix', 'mix'], 'a cake mixer is not a blender');
  assert.deepEqual(actions(['Pica la cebolla.', 'Sofríe la cebolla.'], ['prep', 'fry']), ['prep', 'fry']);
});
