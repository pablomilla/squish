import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase } from '../server/db';
import { TEXT_MODEL, writeCookSteps } from '../server/claude';
import { cleanCookAsk, cookKey, cookPrompt, keepSteps, keptSteps, toCookSteps, COOK_SYSTEM } from '../server/cook';
import { inPlace } from '../server/region';
import { FEATURES } from '../server/routing';

/**
 * How to cook a planned meal: written the first time it is opened, from the
 * ingredients as planned and nothing with energy added, and kept so the same
 * meal is never paid for twice.
 */

// A stand-in Messages API that answers with `reply` and keeps each request.
const requests: Record<string, unknown>[] = [];
let reply: Record<string, unknown> = {};
let api: Server;

before(async () => {
  api = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = JSON.parse(body) as Record<string, unknown>;
      requests.push(request);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model: request.model, stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: JSON.stringify(reply) }],
          usage: { input_tokens: 700, output_tokens: 250 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', () => resolve()));
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
after(async () => {
  api.close();
  if (hasDatabase()) await closeDatabase();
});

const CURRY = {
  title: 'Chickpea and spinach curry',
  slot: 'dinner',
  items: [
    { name: 'chickpeas', portion: '½ tin', grams: 120, nutrients: { calories: 140 } },
    { name: 'spinach', portion: '2 handfuls', grams: 80 },
    { name: 'basmati rice', portion: '1 cup cooked', grams: 150 },
    { name: 'coconut milk (light)', portion: '100 ml', grams: 100, liquid: true },
  ],
};

test('a meal is tidied down to what the method needs, and a meal with nothing in it is refused', () => {
  const ask = cleanCookAsk({ ...CURRY, slot: 'elevenses', items: [...CURRY.items, { name: '   ' }, { name: 'x'.repeat(200), grams: -4 }, null] })!;
  assert.equal(ask.slot, 'dinner', 'an unknown slot is read as dinner');
  assert.equal(ask.items.length, 5, 'empty and missing items are dropped');
  assert.deepEqual(ask.items[0], { name: 'chickpeas', portion: '½ tin', grams: 120 }, 'only the name, portion and amount go to the model');
  assert.equal(ask.items[3].liquid, true);
  assert.equal(ask.items[4].name.length, 80, 'long names are cut');
  assert.equal(ask.items[4].grams, undefined, 'an amount that cannot be true is left out');
  assert.equal(cleanCookAsk({ title: 'Air', items: [] }), null);
  assert.equal(cleanCookAsk({ items: CURRY.items }), null, 'a meal needs a name');
  assert.equal(cleanCookAsk('curry'), null);
});

test('the prompt gives every ingredient with its amount; the rules say nothing with energy may be added', () => {
  const prompt = cookPrompt(cleanCookAsk(CURRY)!);
  assert.match(prompt, /Meal \(dinner\): Chickpea and spinach curry/);
  assert.match(prompt, /- chickpeas \(½ tin, 120 g\)/);
  assert.match(prompt, /- coconut milk \(light\) \(100 ml, 100 ml\)/, 'liquids in ml');
  assert.match(COOK_SYSTEM, /Add nothing that carries energy: no oil/);
  assert.match(COOK_SYSTEM, /in the amount listed/);
});

test("the answer is checked: steps that say something, numbered by the app, and a time that could be true", () => {
  const steps = toCookSteps({ minutes: 25.4, steps: ['1. Rinse the 150 g of rice.', '  ', '2) Simmer for 10 minutes.', 7], tip: '  ' });
  assert.deepEqual(steps, { minutes: 25, steps: ['Rinse the 150 g of rice.', 'Simmer for 10 minutes.'] }, 'no numbers of its own, no empty tip');
  assert.equal(toCookSteps({ minutes: 9999, steps: ['Serve.'], tip: 'Keeps for two days.' }).minutes, 600);
  assert.equal(toCookSteps({ minutes: 'soon', steps: ['Serve.'] }).minutes, 20, 'a time that is not one becomes a guess');
  assert.equal(toCookSteps({ minutes: 5, steps: Array.from({ length: 30 }, (_, i) => `Step ${i}`) }).steps.length, 12);
  assert.throws(() => toCookSteps({ minutes: 10, steps: [] }), /no steps/);
  assert.throws(() => toCookSteps(null), /no steps/);
});

test('the same meal for the same kitchen is the same method; another language or country is not', () => {
  const ask = cleanCookAsk(CURRY)!;
  const gb = { language: 'en', region: 'GB' };
  assert.equal(cookKey(ask, gb), cookKey(cleanCookAsk({ ...CURRY, title: 'CHICKPEA AND SPINACH CURRY' })!, gb), 'case is not a different meal');
  assert.notEqual(cookKey(ask, gb), cookKey(ask, { language: 'es', region: 'GB' }));
  assert.notEqual(cookKey(ask, gb), cookKey(ask, { language: 'en', region: 'US' }), '°F is not °C');
  assert.notEqual(cookKey(ask, gb), cookKey(ask, { ...gb, diet: 'vegan' }));
  const more = cleanCookAsk({ ...CURRY, items: CURRY.items.map((i) => (i.name === 'basmati rice' ? { ...i, grams: 200 } : i)) })!;
  assert.notEqual(cookKey(ask, gb), cookKey(more, gb), 'a bigger portion is a different method: the amounts are in the steps');
});

test('the steps are written by the cheaper text model first, without thinking, in their language and kitchen', async () => {
  assert.equal(FEATURES.find((f) => f.id === 'cook')?.defaults[0], TEXT_MODEL);
  requests.length = 0;
  reply = { minutes: 30, steps: ['Rinse the 150 g of rice and simmer it for 10 minutes.', 'Warm the 120 g of chickpeas in the 100 ml of coconut milk.', 'Stir in the 80 g of spinach until it wilts, then serve.'], tip: '' };
  const { steps, model } = await inPlace({ region: 'US', energy: 'kcal', language: 'en', diet: 'vegan' }, () => writeCookSteps(cleanCookAsk(CURRY)!));

  assert.equal(steps.steps.length, 3);
  assert.equal(steps.minutes, 30);
  assert.equal(model, TEXT_MODEL);
  const request = requests[0] as { model: string; system: string; thinking?: { type: string }; output_config?: { effort?: string } };
  assert.equal(request.model, TEXT_MODEL);
  assert.deepEqual(request.thinking, { type: 'disabled' }, 'writing down a method is not a problem to reason about');
  assert.equal(request.output_config?.effort, 'low');
  assert.match(request.system, /°F/);
  assert.match(request.system, /vegan/);
});

test('steps once written are kept, whoever asks next', async () => {
  const key = cookKey(cleanCookAsk({ ...CURRY, title: `Kept curry ${Date.now()}` })!, { language: 'en', region: 'GB' });
  assert.equal(await keptSteps(key), null);
  await keepSteps(key, { minutes: 20, steps: ['Serve.'] }, TEXT_MODEL);
  assert.deepEqual(await keptSteps(key), { minutes: 20, steps: ['Serve.'] });
  await keepSteps(key, { minutes: 99, steps: ['Something else.'] }, TEXT_MODEL);
  assert.deepEqual(await keptSteps(key), { minutes: 20, steps: ['Serve.'] }, 'the first one written stands');
});
