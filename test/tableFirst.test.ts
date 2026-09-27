import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { analyseLabel, analysePhotoDetailed, analyseRecipe, briefSchema, MEAL_SCHEMA, planWeek, TEXT_MODEL } from '../server/claude';
import { WEEKPLAN_SCHEMA, type WeekPlanRequest } from '../server/weekplan';
import { useTableForTests, type TableFood } from '../server/foodTable';

/**
 * Table first: with a food table loaded, the model is not asked for the
 * figures the table already has — only calories (to check the match) and
 * free sugar (which no table measures) for a food it names in table words.
 * A named food the table cannot answer is filled in by one short text-only
 * question; a dish gets everything in the first answer, as before.
 */

type Sent = { model: string; system: string; prompt: string; itemNutrientsRequired: string[] | null; fill: boolean; schema?: unknown };
const sent: Sent[] = [];
let firstAnswer: Record<string, unknown> = {};
let fillAnswer: Record<string, unknown> = {};
let weekAnswer: Record<string, unknown> = {};
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
        stream?: boolean;
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
        schema: body.output_config?.format?.schema,
      });
      if (body.stream) {
        // A weekly plan is streamed: the same answer, as server-sent events.
        const message = reply(body.model, weekAnswer);
        const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        send('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 3000, output_tokens: 1 } } });
        send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: message.content[0].text } });
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
        send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5000 } });
        send('message_stop', { type: 'message_stop' });
        res.end();
        return;
      }
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

test('a week’s ingredients: two figures each where the table can answer, one fill-in for the whole week', async () => {
  useTableForTests(TABLE);
  sent.length = 0;
  const planNutrients = { calories: 400, protein: 25, carbs: 45, fat: 12, fibre: 6, satFat: 3, sugar: 8, freeSugar: 2, sodium: 700 };
  const ingredient = (name: string, lookup: string, grams: number, nutrients: Record<string, unknown>) => ({ name, emoji: '🍽️', portion: '1', grams, liquid: false, ultraProcessed: false, aisle: 'other', lookup, nutrients });
  weekAnswer = {
    summary: 'A calm week.',
    days: [1, 2].map((day) => ({
      day,
      meals: [
        { slot: 'breakfast', title: 'Oats and banana', items: [ingredient('Banana', 'banana, raw', 120, { calories: 110, freeSugar: 0 }), ingredient('Oats', 'oats, rolled', 50, { calories: 190, freeSugar: 0 })] },
        { slot: 'dinner', title: 'Ready lasagne', items: [ingredient('Lasagne ready meal', '', 400, planNutrients)] },
      ],
    })),
  };
  fillAnswer = { items: [0, 1].map(() => ({ nutrients: { ...full, calories: 187, protein: 6.5, carbs: 30, fat: 3.5 } })) };
  const ask: WeekPlanRequest = {
    startDate: '2026-09-28', days: 2, slots: ['breakfast', 'dinner'], snacks: false, calorieTarget: 1800, proteinTarget: 100,
    fibreTarget: 30, goal: 'maintain', sex: 'female', likes: [], notes: [], preferences: '', cooking: 'normal',
  };

  const plan = await planWeek(ask);
  const [week, fill] = sent;
  assert.equal(sent.length, 2, 'the plan, and one fill-in for the whole week');
  const nested = JSON.stringify(week.schema);
  assert.ok(nested.includes('"required":[]'), 'ingredient nutrients optional in the plan');
  assert.match(week.system, /give only calories and freeSugar/);
  assert.equal(fill.model, TEXT_MODEL);
  assert.equal((fill.prompt.match(/Oats/g) ?? []).length, 2, 'both days’ oats, in one question');
  assert.doesNotMatch(fill.prompt, /Banana|Lasagne/);
  assert.ok(!JSON.stringify(fill.schema).includes('micros'), 'no vitamins and minerals for a plan, as the plan itself has none');

  const [breakfast, dinner] = plan.days[0].meals;
  assert.equal(breakfast.items[0].nutrients.calories, 107);
  assert.equal(breakfast.items[0].source?.name, 'Bananas, raw');
  assert.equal(breakfast.items[1].nutrients.calories, 187);
  assert.equal(breakfast.items[1].nutrients.protein, 6.5);
  assert.equal(dinner.items[0].nutrients.calories, 400, 'a ready meal keeps the plan’s own figures');
  assert.equal(plan.days[0].calories, 107 + 187 + 400);
});

test('the week’s schema, briefly: only the ingredients’ nutrients relaxed', () => {
  const brief = JSON.stringify(briefSchema(WEEKPLAN_SCHEMA as unknown as Record<string, unknown>));
  assert.equal((brief.match(/"required":\[\]/g) ?? []).length, 1);
  assert.ok(JSON.stringify(WEEKPLAN_SCHEMA).includes('"required":["calories"'), 'the original untouched');
});

test('a recipe’s ingredients, by their raw weights: from the table where it can, filled in where not, servings kept', async () => {
  useTableForTests([
    ...TABLE,
    { source: 'cofid', id: '11-400', name: 'Pasta, white, dried, raw', per100: { calories: 342, protein: 12, carbs: 74, fat: 1.5, fibre: 2.9, sugar: 3.1, satFat: 0.2, sodium: 3 } },
    { source: 'cofid', id: '11-401', name: 'Pasta, white, boiled in unsalted water', per100: { calories: 145, protein: 5, carbs: 31, fat: 0.6, fibre: 1.2, sugar: 0.5, satFat: 0.1, sodium: 1 } },
  ]);
  sent.length = 0;
  firstAnswer = {
    ...meal([
      item('Spaghetti', 'pasta, dried', 100, { calories: 350, freeSugar: 0 }),
      item('Pesto', '', 30, { ...full, calories: 150 }),
      item('Pine nuts', 'pine nuts, raw', 10, { calories: 67, freeSugar: 0 }),
    ]),
    servings: 4,
  };
  fillAnswer = { items: [{ nutrients: { ...full, calories: 67, protein: 1.4, carbs: 1.3, fat: 6.8 } }] };

  const recipe = await analyseRecipe({ url: 'https://example.com/pesto-pasta', title: 'Pesto pasta', ingredients: ['400 g spaghetti', '120 g pesto', '40 g pine nuts'] }, 'dinner');
  const [first, fill] = sent;
  assert.match(first.system, /in the state the recipe weighs it/, 'the recipe’s own rule for table names');
  assert.match(first.system, /give only calories and freeSugar/);
  assert.equal(first.itemNutrientsRequired?.length, 0);
  assert.equal(sent.length, 2);
  assert.match(fill.prompt, /Pine nuts/);

  const [pasta, pesto, nuts] = recipe.items;
  assert.equal(pasta.source?.name, 'Pasta, white, dried, raw', 'dried weight, dried figures — never the boiled row');
  assert.equal(pasta.nutrients.calories, 342);
  assert.equal(pesto.nutrients.calories, 150, 'a jar of sauce keeps the AI’s figures');
  assert.equal(nuts.nutrients.fat, 6.8, 'filled in');
  assert.equal(recipe.servings, 4);
});
