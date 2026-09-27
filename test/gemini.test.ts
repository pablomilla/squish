import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { MEAL_SCHEMA } from '../server/claude';
import { analysePhotoGemini, priceGemini, toGeminiSchema } from '../server/gemini';
import { useTableForTests } from '../server/foodTable';

/**
 * Gemini, for the benchmark: asked exactly what Claude is asked, read into
 * exactly the same shape — and never reachable from the app itself, whose
 * privacy policy names Anthropic alone.
 */

let requests: { url: string; key: string | undefined; body: Record<string, unknown> }[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };
let api: Server;

before(async () => {
  api = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ url: req.url ?? '', key: req.headers['x-goog-api-key'] as string | undefined, body: JSON.parse(body) });
      res.statusCode = answer.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', () => resolve()));
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  process.env.GEMINI_API_KEY = 'gm-test';
  // No food table unless a test brings one: nothing here touches the database.
  useTableForTests([]);
});
after(() => {
  api.close();
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GEMINI_API_KEY;
  useTableForTests(null);
});

const MEAL = {
  title: 'Porridge and berries', slot: 'breakfast', confidence: 'high', score: 80, coachNote: 'A warm start!',
  question: '', choices: [],
  items: [{ name: 'Porridge', emoji: '🥣', portion: '1 bowl', grams: 250, liquid: false, ultraProcessed: false, aisle: 'cupboard', nutrients: { calories: 300, protein: 10, carbs: 50, fat: 6, fibre: 5, satFat: 2, sugar: 12, freeSugar: 0, sodium: 80, micros: { iron: 2, calcium: 200, vitaminD: 0, vitaminB12: 1, folate: 20, vitaminC: 0 } } }],
};
const replyWith = (meal: unknown, extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    candidates: [{ content: { parts: [{ text: JSON.stringify(meal) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1800, candidatesTokenCount: 700, thoughtsTokenCount: 1300 },
    modelVersion: 'gemini-2.5-flash',
    ...extra,
  },
});

test('the meal schema, in the dialect Gemini takes', () => {
  const schema = JSON.stringify(toGeminiSchema(MEAL_SCHEMA));
  assert.ok(!schema.includes('additionalProperties'), 'which it rejects');
  assert.ok(!/"type":"(object|array|string|number|integer|boolean)"/.test(schema), 'type names in upper case');
  const converted = toGeminiSchema(MEAL_SCHEMA) as { type: string; required: string[]; properties: Record<string, { type: string; format?: string; enum?: string[] }> };
  assert.equal(converted.type, 'OBJECT');
  assert.deepEqual(converted.required, MEAL_SCHEMA.required, 'every field still required');
  assert.deepEqual(converted.properties.slot, { type: 'STRING', enum: ['breakfast', 'lunch', 'dinner', 'snack'], format: 'enum' });
});

test('a photo goes with the same instructions as Claude’s, and comes back in the same shape', async () => {
  requests = [];
  answer = replyWith(MEAL);
  const { analysis, usage } = await analysePhotoGemini('aGVsbG8=', 'image/jpeg', 'breakfast', undefined, 'gemini-2.5-flash', { plateCm: 27 });
  assert.equal(analysis.title, 'Porridge and berries');
  assert.equal(analysis.nutrients.calories, 300);
  assert.equal(analysis.items[0].aisle, 'cupboard');

  const [sent] = requests;
  assert.equal(sent.url, '/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(sent.key, 'gm-test', 'the key in a header, not the address');
  const body = sent.body as { systemInstruction: { parts: { text: string }[] }; contents: { parts: Record<string, unknown>[] }[]; generationConfig: Record<string, unknown> };
  assert.match(body.systemInstruction.parts[0].text, /nutrition engine behind Squish/);
  assert.deepEqual(body.contents[0].parts[0], { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } });
  assert.match(String(body.contents[0].parts[1].text), /27 cm/, 'the plate size, as Claude is told it');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');

  assert.equal(usage.outputTokens, 2000, 'thinking counted with the answer');
  assert.equal(usage.costUsd, priceGemini('gemini-2.5-flash', { promptTokenCount: 1800, candidatesTokenCount: 700, thoughtsTokenCount: 1300 }));
  assert.ok(Math.abs((usage.costUsd ?? 0) - (1800 * 0.3 + 2000 * 2.5) / 1e6) < 1e-12);
});

test('a refusal, a cut-off answer or an error is a failed attempt, with the reason', async () => {
  answer = { status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } };
  await assert.rejects(analysePhotoGemini('aGVsbG8=', 'image/jpeg'), /declined the photo \(SAFETY\)/);
  answer = replyWith(MEAL);
  (answer.body as { candidates: { finishReason: string }[] }).candidates[0].finishReason = 'MAX_TOKENS';
  await assert.rejects(analysePhotoGemini('aGVsbG8=', 'image/jpeg'), /stopped early \(MAX_TOKENS\)/);
  answer = { status: 400, body: { error: { message: 'API key not valid.' } } };
  await assert.rejects(analysePhotoGemini('aGVsbG8=', 'image/jpeg'), /Gemini 400: API key not valid/);
  assert.equal(priceGemini('gemini-9-imaginary', { promptTokenCount: 1 }), null, 'no price on file: no made-up cost');
});

test('nothing in the app sends a photo to Google except an admin’s own, through the trial switch', () => {
  // Only the trial's switch and the one photo route may reach Gemini; nothing else in the server.
  const allowed = new Set(['gemini.ts', 'modelTrial.ts', 'index.ts']);
  for (const file of readdirSync('server').filter((f) => f.endsWith('.ts') && !allowed.has(f))) {
    assert.doesNotMatch(readFileSync(`server/${file}`, 'utf8'), /from '\.\/gemini'/, `server/${file} imports gemini`);
  }
  assert.doesNotMatch(readFileSync('server/modelTrial.ts', 'utf8'), /analysePhotoGemini/, 'the switch decides; it does not send');
  // In the routes, Gemini is called once, only after photoReader has said so.
  const routes = readFileSync('server/index.ts', 'utf8');
  const calls = [...routes.matchAll(/analysePhotoGemini\(/g)];
  assert.equal(calls.length, 1, 'one call to Gemini in the routes');
  const gate = routes.lastIndexOf("reader.reader === 'gemini'", calls[0].index);
  const decided = routes.lastIndexOf('await photoReader(req.device)', gate);
  assert.ok(decided > 0 && gate > decided && calls[0].index! - decided < 400, 'and only just after photoReader chose Gemini');
  assert.match(readFileSync('scripts/bench.ts', 'utf8'), /from '\.\.\/server\/gemini'/);
});

test('with a food table, Gemini is asked table first too: two figures for a named food, the table for the rest', async () => {
  useTableForTests([{ source: 'usda', id: '1', name: 'Porridge oats, cooked', per100: { calories: 71, protein: 2.5, carbs: 12, fat: 1.5, fibre: 1.7, sugar: 0.3 } }]);
  requests = [];
  answer = replyWith({ ...MEAL, items: [{ ...MEAL.items[0], lookup: 'porridge oats, cooked', nutrients: { calories: 190, freeSugar: 0 } }] });
  const { analysis } = await analysePhotoGemini('aGVsbG8=', 'image/jpeg', 'breakfast');
  useTableForTests([]);

  const body = requests[0].body as { systemInstruction: { parts: { text: string }[] }; generationConfig: { responseSchema: unknown } };
  assert.match(body.systemInstruction.parts[0].text, /give only calories and freeSugar/);
  const schema = JSON.stringify(body.generationConfig.responseSchema);
  assert.ok(schema.includes('"nutrients":{"type":"OBJECT"'), 'nutrients still described');
  assert.ok(!schema.includes('"required":[]'), 'an empty required list is left out rather than sent');
  assert.equal(analysis.items[0].source?.name, 'Porridge oats, cooked');
  assert.equal(analysis.items[0].nutrients.calories, 178, '250 g at 71 kcal per 100 g');
});
