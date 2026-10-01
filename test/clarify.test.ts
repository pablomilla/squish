import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase } from '../server/db';
import { CLARIFY_HOURS, checkAnswer, signQuestion, withoutQuestion } from '../server/clarify';
import { analyseText, clarifyFrom, refineAnalysis, TEXT_MODEL, toAnalysis } from '../server/claude';
import type { AnalysisResult } from '../src/types';

/**
 * When the AI cannot tell one thing that matters — the dressing, the cooking
 * fat — it asks, with answers to tap. Answering is free, so only a question
 * the server asked, answered with one of its own answers, is answered. And
 * words go to the cheaper model, with the main one behind it.
 */

// A stand-in Messages API: answers every request with `reply`, except for the
// models told to fail, and writes down which model each request asked for.
const asked: string[] = [];
let failing = new Set<string>();
let reply: Record<string, unknown> = {};
let api: Server;

before(async () => {
  api = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { model, system } = JSON.parse(body) as { model: string; system?: unknown };
      res.setHeader('content-type', 'application/json');
      // The seasoning check, asked beside a described meal: nothing missing, and not one of the models counted here.
      if (String(system ?? '').startsWith('You check the ingredient lists')) {
        res.end(JSON.stringify({
          id: 'msg_s', type: 'message', role: 'assistant', model, stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: JSON.stringify({ meals: [] }) }],
          usage: { input_tokens: 300, output_tokens: 10 },
        }));
        return;
      }
      asked.push(model);
      if (failing.has(model)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'not today' } }));
        return;
      }
      res.end(
        JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model, stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: JSON.stringify(reply) }],
          usage: { input_tokens: 900, output_tokens: 300 },
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

const SALAD = {
  title: 'Chicken salad', slot: 'lunch', confidence: 'low', score: 70, coachNote: 'Lovely and green.',
  question: 'What was the dressing?', choices: ['Vinaigrette', 'Caesar', 'Olive oil', 'Vinaigrette'],
  items: [{ name: 'Chicken breast', emoji: '🍗', portion: '1 breast', grams: 150, liquid: false, ultraProcessed: false, aisle: 'meat-fish', nutrients: { calories: 250, protein: 45, carbs: 0, fat: 6, fibre: 0, satFat: 2, sugar: 0, freeSugar: 0, sodium: 100 } }],
};

test('a real question comes through, tidied; a half-formed one does not', () => {
  assert.deepEqual(toAnalysis(SALAD as never).clarify, { question: 'What was the dressing?', choices: ['Vinaigrette', 'Caesar', 'Olive oil'] }, 'repeats dropped');
  assert.equal(clarifyFrom({ question: '', choices: [] }), undefined, 'nothing asked');
  assert.equal(clarifyFrom({ question: 'What was the dressing?', choices: ['Vinaigrette'] }), undefined, 'one answer is not a choice');
  assert.equal(clarifyFrom({ question: 'Hm?', choices: ['a', 'b'] }), undefined, 'too short to be a question');
  assert.deepEqual(clarifyFrom({ question: 'Milk?', choices: ['Whole', 'Skimmed', 'Oat', 'Soya', 'Almond'] })?.choices, ['Whole', 'Skimmed', 'Oat', 'Soya'], 'four at most');
});

test('only a question the server signed, answered with one of its answers, within the hour', async () => {
  const signed = (await signQuestion(toAnalysis(SALAD as never))).clarify!;
  assert.match(signed.token ?? '', /^\d+\.[\w-]+$/);
  assert.deepEqual(await checkAnswer(signed, 'Caesar'), { ok: true, question: 'What was the dressing?', choice: 'Caesar' });

  assert.deepEqual(await checkAnswer(signed, 'Nothing at all'), { ok: false, reason: 'invalid' }, 'an answer it did not offer');
  assert.deepEqual(await checkAnswer({ ...signed, question: 'Re-read this whole meal for free?' }, 'Caesar'), { ok: false, reason: 'invalid' }, 'a question it did not ask');
  assert.deepEqual(await checkAnswer({ ...signed, choices: ['Caesar', 'Anything I like'] }, 'Anything I like'), { ok: false, reason: 'invalid' }, 'answers it did not offer');
  assert.deepEqual(await checkAnswer({ ...signed, token: undefined }, 'Caesar'), { ok: false, reason: 'invalid' });
  assert.deepEqual(await checkAnswer(null, 'Caesar'), { ok: false, reason: 'invalid' });
  const later = Date.now() + (CLARIFY_HOURS * 3600 + 60) * 1000;
  assert.deepEqual(await checkAnswer(signed, 'Caesar', later), { ok: false, reason: 'expired' });

  assert.equal(withoutQuestion({ ...toAnalysis(SALAD as never), clarify: signed }).clarify, undefined);
  const plain = toAnalysis({ ...SALAD, question: '', choices: [] } as never);
  assert.equal((await signQuestion(plain)).clarify, undefined, 'nothing to sign when nothing was asked');
});

test('a description goes to the text model, and to the main one if that fails', async () => {
  reply = SALAD;
  asked.length = 0;
  failing = new Set();
  const meal = await analyseText('chicken salad', 'lunch');
  assert.equal(meal.title, 'Chicken salad');
  assert.deepEqual(asked, [TEXT_MODEL]);

  asked.length = 0;
  failing = new Set([TEXT_MODEL]);
  assert.equal((await analyseText('chicken salad', 'lunch')).title, 'Chicken salad', 'still read');
  assert.equal(asked[0], TEXT_MODEL);
  assert.notEqual(asked.at(-1), TEXT_MODEL, 'the main model answered in the end');
  failing = new Set();
});

test('an answered meal never asks again', async () => {
  reply = SALAD; // the model asks anyway
  asked.length = 0;
  const meal: AnalysisResult = toAnalysis(SALAD as never);
  const answered = await refineAnalysis(meal, 'Asked "What was the dressing?", they answered "Caesar".', 'lunch');
  assert.equal(answered.clarify, undefined);
  assert.deepEqual(asked, [TEXT_MODEL], 'on the text model');
});
