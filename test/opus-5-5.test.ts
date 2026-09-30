import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

/**
 * Opus 5.5 as the main model: the default wherever Opus 5 was, asked in a
 * shape it accepts, with room to think on the calls that were sized for an
 * answer alone, and a declined question handed to the backup rather than
 * turned away.
 */

delete process.env.SQUISH_MODEL;
delete process.env.SQUISH_CHAT_MODEL;
delete process.env.DATABASE_URL;

type Sent = { model: string; max_tokens: number; thinking?: { type: string } };
const sent: Sent[] = [];
let declining = new Set<string>();
let api: Server;

before(async () => {
  api = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw) as Sent & { system: unknown };
      sent.push({ model: body.model, max_tokens: body.max_tokens, thinking: body.thinking });
      const system = JSON.stringify(body.system);
      const text = system.includes('small round blob mascot')
        ? 'Nice work on the fibre today.'
        : `Answered by ${body.model}.`;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'msg', type: 'message', role: 'assistant', model: body.model, stop_sequence: null,
        stop_reason: declining.has(body.model) ? 'refusal' : 'end_turn',
        content: declining.has(body.model) ? [] : [{ type: 'text', text }],
        usage: { input_tokens: 800, output_tokens: 60 },
      }));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', () => resolve()));
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
after(() => api.close());

const context = { date: '2026-09-30', goal: 'lose', calorieTarget: 1800, proteinTarget: 110, today: 'Nothing yet.', week: 'Quiet.', streak: 3, recentMeals: [] };
const ask = [{ role: 'user' as const, content: 'Is it safe to eat raw cookie dough?' }];

test('Opus 5.5 is the main model, with the cheaper model behind it', async () => {
  const { MAIN_MODEL } = await import('../server/providers');
  const { FEATURES } = await import('../server/routing');
  assert.equal(MAIN_MODEL, 'claude-opus-5-5');
  for (const id of ['photo', 'label', 'recipe', 'chat', 'weekplan', 'coach']) {
    assert.equal(FEATURES.find((f) => f.id === id)!.defaults[0], 'claude-opus-5-5', id);
  }
  // The words stay on the cheaper model first, with Opus 5.5 as their backup.
  assert.deepEqual(FEATURES.find((f) => f.id === 'words')!.defaults, ['claude-sonnet-5', 'claude-opus-5-5']);
});

test('the one-line nudge has room to think, and is never sent thinking: disabled', async () => {
  const { coachMessage } = await import('../server/claude');
  sent.length = 0;
  const nudge = await coachMessage({
    name: 'Sam', goal: 'lose', streak: 3, caloriesEaten: 900, caloriesTarget: 1800, protein: 50, proteinTarget: 110,
    fibre: 12, water: 4, waterTarget: 8, mealsLogged: 2, timeOfDay: '14:00', recentMeals: ['porridge'],
  });
  assert.equal(nudge, 'Nice work on the fibre today.');
  assert.equal(sent[0].model, 'claude-opus-5-5');
  assert.equal(sent[0].max_tokens, 4400, 'the 400-token line, plus room for thinking');
  assert.notEqual(sent[0].thinking?.type, 'disabled', 'Opus 5.5 refuses thinking: disabled');
});

test('the nutritionist has room to think on Opus 5.5, and as before on Opus 5', async () => {
  const { chatRequest } = await import('../server/chat');
  assert.equal(chatRequest(ask, context).max_tokens, 6400);
  assert.equal(chatRequest(ask, context, [], { model: 'claude-opus-5' }).max_tokens, 2400);
});

test('a question Opus 5.5 declines is answered by the backup', async () => {
  const { chatStep } = await import('../server/chat');
  declining = new Set(['claude-opus-5-5']);
  sent.length = 0;
  const step = await chatStep(ask, context);
  assert.deepEqual(sent.map((s) => s.model), ['claude-opus-5-5', 'claude-sonnet-5']);
  assert.ok(step.done && step.reply === 'Answered by claude-sonnet-5.', 'the backup answered');
});

test('declined by every model, the person is told kindly rather than shown an error', async () => {
  const { chatStep } = await import('../server/chat');
  declining = new Set(['claude-opus-5-5', 'claude-sonnet-5']);
  const step = await chatStep(ask, context);
  assert.ok(step.done && /can't help with that one/.test(step.reply));
  declining = new Set();
});
