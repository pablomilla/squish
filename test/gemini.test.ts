import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { MEAL_SCHEMA, analysePhotoDetailed } from '../server/claude';
import { priceGemini, toGeminiSchema } from '../server/gemini';
import { fromGemini, geminiRequest } from '../server/providers';
import { useTableForTests } from '../server/foodTable';

/**
 * Gemini, answering requests built for Claude: asked exactly what Claude is
 * asked, read into exactly the same shape — and reached only through a route
 * that allows it (server/routing.ts), never directly.
 */
const analysePhotoGemini = (image: string, type: string, slot?: 'breakfast', hint?: string, model = 'gemini-2.5-flash', crockery?: { plateCm: number }) =>
  analysePhotoDetailed(image, type, slot, hint, model, crockery);

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
  await assert.rejects(analysePhotoGemini('aGVsbG8=', 'image/jpeg'), /declined to analyse/);
  answer = replyWith(MEAL);
  const cut = answer.body as { candidates: { finishReason: string; content: { parts: { text: string }[] } }[] };
  cut.candidates[0].finishReason = 'MAX_TOKENS';
  cut.candidates[0].content.parts[0].text = '{"title": "Porri';
  await assert.rejects(analysePhotoGemini('aGVsbG8=', 'image/jpeg'), SyntaxError, 'half an answer does not parse, so a backup is asked');
  answer = { status: 400, body: { error: { message: 'API key not valid.' } } };
  await assert.rejects(analysePhotoGemini('aGVsbG8=', 'image/jpeg'), /Gemini 400: API key not valid/);
  assert.equal(priceGemini('gemini-9-imaginary', { promptTokenCount: 1 }), null, 'no price on file: no made-up cost');
  const usage = { promptTokenCount: 2000, candidatesTokenCount: 600, thoughtsTokenCount: 400 };
  const cost = (at: string) => priceGemini('gemini-3.8-flash', usage, new Date(at));
  assert.ok(Math.abs(cost('2026-09-27T12:00:00Z')! - (2000 * 0.75 + 1000 * 3.75) / 1e6) < 1e-12, '3.8 Flash at its introductory price');
  assert.ok(Math.abs(cost('2026-12-31T23:59:00Z')! - (2000 * 0.75 + 1000 * 3.75) / 1e6) < 1e-12, 'up to the last day of 2026');
  assert.ok(Math.abs(cost('2027-01-01T00:00:00Z')! - (2000 * 1.5 + 1000 * 7.5) / 1e6) < 1e-12, 'and the standard price from New Year, by itself');
});

test('the nutritionist in Gemini’s shape: tools declared, lookups asked for and answered, Claude’s thinking left out', () => {
  const tools: Anthropic.Tool[] = [
    { name: 'look_up_days', description: 'Totals by day.', input_schema: { type: 'object', properties: { from: { type: 'string' } }, required: ['from'] } },
  ];
  const request = geminiRequest({
    model: 'gemini-3.8-flash',
    max_tokens: 2400,
    system: [{ type: 'text', text: 'You are Squish.' }, { type: 'text', text: 'Their diary.' }],
    tools,
    messages: [
      { role: 'user', content: 'How was Tuesday?' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me look.', signature: 'claude-only' },
          { type: 'tool_use', id: 'toolu_1', name: 'look_up_days', input: { from: '2026-09-22' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"calories":1800}' }] },
    ],
  }) as {
    systemInstruction: { parts: { text: string }[] };
    contents: { role: string; parts: Record<string, unknown>[] }[];
    tools: { functionDeclarations: { name: string; parameters: { type: string } }[] }[];
    generationConfig: Record<string, unknown>;
  };
  assert.equal(request.systemInstruction.parts[0].text, 'You are Squish.\n\nTheir diary.');
  assert.equal(request.tools[0].functionDeclarations[0].name, 'look_up_days');
  assert.equal(request.tools[0].functionDeclarations[0].parameters.type, 'OBJECT');
  assert.deepEqual(request.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(request.contents[1].parts.length, 1, 'the thinking is Claude’s own and stays behind');
  assert.deepEqual((request.contents[1].parts[0] as { functionCall: unknown }).functionCall, { id: 'toolu_1', name: 'look_up_days', args: { from: '2026-09-22' } });
  assert.ok((request.contents[1].parts[0] as { thoughtSignature?: string }).thoughtSignature, 'a call Gemini did not sign goes with the placeholder');
  assert.deepEqual(request.contents[2].parts[0], { functionResponse: { id: 'toolu_1', name: 'look_up_days', response: { result: '{"calories":1800}' } } });
  assert.ok(!('responseSchema' in request.generationConfig), 'tools and a fixed answer shape are not asked for together');

  // Gemini asks for a lookup: it comes back as Claude's tool_use, and its signature goes back with it next time.
  const asked = fromGemini('gemini-3.8-flash', {
    candidates: [{ content: { parts: [{ functionCall: { name: 'look_up_days', args: { from: '2026-09-23' } }, thoughtSignature: 'sig-1' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 20, thoughtsTokenCount: 80 },
  });
  assert.equal(asked.stop_reason, 'tool_use');
  const call = asked.content[0] as Anthropic.ToolUseBlock;
  assert.equal(call.name, 'look_up_days');
  assert.match(call.id, /^gm_[0-9a-f]+$/, 'an id Claude would accept too');
  assert.equal(asked.usage.output_tokens, 100, 'thinking counted with the answer');
  const next = geminiRequest({ model: 'gemini-3.8-flash', max_tokens: 100, messages: [{ role: 'assistant', content: asked.content as Anthropic.ContentBlockParam[] }] }) as {
    contents: { parts: { thoughtSignature?: string }[] }[];
  };
  assert.equal(next.contents[0].parts[0].thoughtSignature, 'sig-1');
  assert.equal(fromGemini('gemini-3.8-flash', { candidates: [{ content: { parts: [{ text: 'No.' }] }, finishReason: 'SAFETY' }] }).stop_reason, 'refusal');
});

test('only the adapter talks to Google, and every model call goes through it', () => {
  // gemini.ts is the wire; providers.ts the only caller of it; pricing and routing read its price list.
  const allowed = new Set(['gemini.ts', 'providers.ts', 'pricing.ts', 'routing.ts', 'index.ts']);
  for (const file of readdirSync('server').filter((f) => f.endsWith('.ts') && !allowed.has(f))) {
    assert.doesNotMatch(readFileSync(`server/${file}`, 'utf8'), /from '\.\/gemini'/, `server/${file} imports gemini`);
  }
  for (const file of ['pricing.ts', 'routing.ts', 'index.ts']) {
    assert.doesNotMatch(readFileSync(`server/${file}`, 'utf8'), /geminiGenerate/, `server/${file} calls Google itself`);
  }
  // So every one follows a route, with its backups and its privacy rule.
  for (const file of readdirSync('server').filter((f) => f.endsWith('.ts') && f !== 'providers.ts')) {
    assert.doesNotMatch(readFileSync(`server/${file}`, 'utf8'), /messages\.(create|stream)\(/, `server/${file} asks Anthropic directly`);
  }
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
