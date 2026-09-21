import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { CHAT_SYSTEM, MAX_TOOL_ROUNDS, chatRequest, type ChatContext, type ChatMessage } from '../server/chat';
import { NUTRITIONIST_TOOLS } from '../server/nutritionist-tools';
import { priceUsage } from '../server/claude';

/**
 * What the nutritionist costs to run.
 *
 * Caching is the one optimisation that fails silently: nothing errors, no
 * answer changes, the bill is simply ten times what it should be. So what is
 * pinned here is the shape that makes it work — where the breakpoints fall,
 * and that the bytes in front of the first one really are the same on every
 * call for every person.
 */

const context: ChatContext = {
  date: '2026-05-20',
  goal: 'lose',
  calorieTarget: 1900,
  proteinTarget: 120,
  today: '1420 kcal, 78 g protein, across 3 meals',
  week: '6 of 7 days logged, averaging 1880 kcal',
  streak: 12,
  recentMeals: ['Porridge (420 kcal)'],
};

const systemBlocks = (request: Anthropic.MessageCreateParamsNonStreaming) =>
  request.system as Anthropic.TextBlockParam[];

const ask = (text: string): ChatMessage[] => [{ role: 'user', content: text }];

test('the rules and the tools are cached, and the diary is not', () => {
  const request = chatRequest(ask('how was my week?'), context, [{ id: 'n1', note: 'Vegetarian' }]);
  const blocks = systemBlocks(request);

  assert.equal(blocks[0].text, CHAT_SYSTEM, 'the cached block is the rules, whole and unmixed');
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral' });
  // Their week and what it remembers move; they belong after the breakpoint.
  assert.match(blocks[1].text, /1880 kcal/);
  assert.match(blocks[1].text, /Vegetarian/);
  assert.equal(blocks[1].cache_control, undefined);
});

test('the cached prefix is the same bytes for two different people', () => {
  const mine = chatRequest(ask('what am I short of?'), context, [{ id: 'n1', note: 'Allergic to shellfish' }]);
  const yours = chatRequest(ask('how were my weekends?'), { ...context, goal: 'gain', calorieTarget: 2800, streak: 0 }, []);

  // This is the whole of it. Interpolate anything personal into CHAT_SYSTEM —
  // their name, their targets, today's date — and every read becomes a write.
  assert.equal(systemBlocks(mine)[0].text, systemBlocks(yours)[0].text);
  assert.deepEqual(mine.tools, yours.tools);
});

test('the growing conversation is cached too', () => {
  // Each round resends everything before it. Without this marker the same
  // history is paid for in full once per lookup.
  const request = chatRequest(ask('how was my week?'), context);
  assert.deepEqual(request.cache_control, { type: 'ephemeral' });
});

test('the cached prefix is long enough to be worth caching', () => {
  const request = chatRequest(ask('hello'), context);
  const prefix = JSON.stringify(request.tools) + systemBlocks(request)[0].text;

  // Opus 5 will not cache a prefix under 512 tokens — it fails quietly, with
  // no error and no cache entry. At any plausible ratio this clears it.
  assert.ok(prefix.length > 2500, `cached prefix is only ${prefix.length} characters`);
});

test('the tools go away once the lookups are spent', () => {
  const results: ChatMessage = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] };
  const spent = [...ask('how was my week?'), ...Array.from({ length: MAX_TOOL_ROUNDS }, () => results)];

  assert.equal(chatRequest(spent, context).tools, undefined, 'it has to answer with what it has');
  assert.equal(chatRequest(ask('how was my week?'), context).tools?.length, NUTRITIONIST_TOOLS.length);
});

test('a cached call is priced as a cached call', () => {
  const uncached = priceUsage('claude-opus-5', { inputTokens: 10_000, outputTokens: 1_000 });
  const cached = priceUsage('claude-opus-5', {
    inputTokens: 200,
    outputTokens: 1_000,
    cacheReadTokens: 9_800,
  });

  assert.equal(uncached, (10_000 * 5 + 1_000 * 25) / 1e6);
  // Reads at a tenth: 200 + 980 charged instead of 10,000.
  assert.equal(cached, ((200 + 980) * 5 + 1_000 * 25) / 1e6);
  assert.ok((cached as number) < (uncached as number));

  // And a write costs more than an ordinary token, not less. Counting it as
  // free is how caching comes to look like a saving on its first call.
  const writing = priceUsage('claude-opus-5', { inputTokens: 200, outputTokens: 1_000, cacheWriteTokens: 9_800 });
  assert.ok((writing as number) > (uncached as number) * 0.9);
  assert.equal(priceUsage('some-other-model', { inputTokens: 1, outputTokens: 1 }), null);
});

test('it is told what day it is, because every tool here takes a date', () => {
  const request = chatRequest([{ role: 'user', content: 'how was last week?' }], context);
  const spoken = (request.system as Anthropic.TextBlockParam[])[1].text;

  // An eval run found the models asking about the right day of the wrong
  // year — 96 of about 800 dates landed inside the diary at all — because
  // nothing anywhere said what today was.
  assert.match(spoken, /Today is Wednesday 20 May 2026/);
  assert.match(spoken, /2026-05-20/, 'and in the form the tools actually take');
});
