import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { analyseLabel, analysePhotoDetailed, briefSchema, MEAL_SCHEMA, TEXT_MODEL } from '../server/claude';
import { useTableForTests, type TableFood } from '../server/foodTable';

/**
 * Table first: with a food table loaded, the model is not asked for the
 * figures the table already has — only calories (to check the match) and
 * free sugar (which no table measures) for a food it names in table words.
 * A named food the table cannot answer is filled in by one short text-only
 * question; a dish gets everything in the first answer, as before.
 */

type Sent = { model: string; system: string; prompt: string; itemNutrientsRequired: string[] | null; fill: boolean };
const sent: Sent[] = [];
let firstAnswer: Record<string, unknown> = {};
let fillAnswer: Record<string, unknown> = {};
let failing = new Set<string>();
let api: Server;

const reply = (model: string, body: unknown) => ({
  id: 'msg', type: 'message', role: 'assistant', model, stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text: JSON.stringify(body) }],
  usage: { input_tokens: 1000, output_tokens: 400 },
});

before(async () => {
  api = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw) as {
        model: string;
        system: string;
        messages: { content: string | { type: string; text?: string }[] }[];
        output_config?: { format?: { schema?: { properties?: { items?: { items?: { properties?: { nutrients?: { required?: string[] } } } } } } } };
      };
      const content = body.messages[0].content;
      const prompt = typeof content === 'string' ? content : content.map((part) => part.text ?? '').join(' ');
      const fill = body.system.includes('You are given foods from one meal');
      sent.push({
        model: body.model, system: body.system, prompt, fill,
        itemNutrientsRequired: body.output_config?.format?.schema?.properties?.items?.items?.properties?.nutrients?.required ?? null,
      });
      res.setHeader('content-type', 'application/json');
      if (failing.has(body.model)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'not today' } }));
        return;
      }
      res.end(JSON.stringify(reply(body.model, fill ? fillAnswer : firstAnswer)));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', () => resolve()));
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
after(() => {
  api.close();
  useTableForTests(null);
});

const TABLE: TableFood[] = [
  { source: 'usda', id: '173944', name: 'Bananas, raw', per100: { calories: 89, protein: 1.09, fat: 0.33, carbs: 22.84, fibre: 2.6, sugar: 12.23, satFat: 0.112, sodium: 1, vitaminC: 8.7 } },
];
const full = { calories: 480, protein: 30, carbs: 40, fat: 20, fibre: 5, satFat: 8, sugar: 9, freeSugar: 3, sodium: 900, micros: { iron: 3, calcium: 100, vitaminD: 0, vitaminB12: 1, folate: 40, vitaminC: 10 } };
const meal = (items: Record<string, unknown>[]) => ({ title: 'Lunch', slot: 'lunch', confidence: 'high', score: 70, coachNote: 'Nice.', question: '', choices: [], items });
const item = (name: string, lookup: string, grams: number, nutrients: Record<string, unknown>) => ({ name, emoji: '🍽️', portion: '1', grams, liquid: false, ultraProcessed: false, aisle: 'other', lookup, nutrients });
const photo = () => analysePhotoDetailed('aGVsbG8=', 'image/jpeg', 'lunch', undefined, 'claude-opus-5');

test('the schema, briefly: every nutrient optional, nothing else changed', () => {
  const brief = briefSchema(MEAL_SCHEMA) as typeof MEAL_SCHEMA;
  assert.deepEqual(brief.properties.items.items.properties.nutrients.required, []);
  assert.deepEqual(MEAL_SCHEMA.properties.items.items.properties.nutrients.required.length, 10, 'the original untouched');
  assert.deepEqual(brief.properties.items.items.required, MEAL_SCHEMA.properties.items.items.required);
});

test('with a table: two figures for a named food, all for a dish, and only the unmatched named food filled in', async () => {
  useTableForTests(TABLE);
  sent.length = 0;
  firstAnswer = meal([
    item('Banana', 'banana, raw', 120, { calories: 110, freeSugar: 0 }),
    item('Chicken curry', '', 350, full),
    item('Teff', 'teff, cooked', 150, { calories: 150, freeSugar: 0 }),
  ]);
  fillAnswer = { items: [{ nutrients: { ...full, calories: 153, protein: 6, carbs: 30, fat: 1, freeSugar: 0 } }] };

  const { analysis, usage } = await photo();
  assert.equal(sent.length, 2, 'the photo, and one short question');
  const [first, fill] = sent;
  assert.equal(first.model, 'claude-opus-5');
  assert.deepEqual(first.itemNutrientsRequired, [], 'nutrients optional in the first answer');
  assert.match(first.system, /give only calories and freeSugar/);
  assert.equal(fill.model, TEXT_MODEL, 'the fill is words, so the cheaper model');
  assert.match(fill.prompt, /1\. Teff — 1, 150 g \(teff, cooked\)/);
  assert.doesNotMatch(fill.prompt, /Banana|curry/, 'only the food the table could not answer');

  const [banana, curry, teff] = analysis.items;
  assert.equal(banana.nutrients.calories, 107);
  assert.equal(banana.source?.name, 'Bananas, raw');
  assert.equal(curry.nutrients.calories, 480);
  assert.equal(curry.nutrients.protein, 30);
  assert.equal(teff.nutrients.calories, 153);
  assert.equal(teff.nutrients.protein, 6);
  assert.equal(analysis.nutrients.calories, 107 + 480 + 153);
  assert.equal(usage.outputTokens, 800, 'both calls counted');
});

test('everything matched or described: one call, nothing filled', async () => {
  useTableForTests(TABLE);
  sent.length = 0;
  firstAnswer = meal([item('Banana', 'banana, raw', 120, { calories: 110, freeSugar: 0 }), item('Chicken curry', '', 350, full)]);
  await photo();
  assert.equal(sent.length, 1);
});

test('no table loaded: every figure asked for, as before', async () => {
  useTableForTests([]);
  sent.length = 0;
  firstAnswer = meal([item('Banana', 'banana, raw', 120, full)]);
  await photo();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].itemNutrientsRequired?.length, 10);
  assert.doesNotMatch(sent[0].system, /give only calories and freeSugar/);
});

test('a label is never brief: its printed figures are the point', async () => {
  useTableForTests(TABLE);
  sent.length = 0;
  firstAnswer = meal([item('Oat bar', '', 40, full)]);
  await analyseLabel('aGVsbG8=', 'image/jpeg', 'snack');
  assert.equal(sent[0].itemNutrientsRequired?.length, 10);
});

test('if the text model cannot fill the figures, the main one does', async () => {
  useTableForTests(TABLE);
  sent.length = 0;
  failing = new Set([TEXT_MODEL]);
  firstAnswer = meal([item('Teff', 'teff, cooked', 150, { calories: 150, freeSugar: 0 })]);
  fillAnswer = { items: [{ nutrients: { ...full, calories: 153 } }] };
  const { analysis } = await photo();
  assert.deepEqual(sent.map((s) => [s.model, s.fill]), [['claude-opus-5', false], [TEXT_MODEL, true], ['claude-opus-5', true]]);
  assert.equal(analysis.items[0].nutrients.calories, 153);
  failing = new Set();
});
