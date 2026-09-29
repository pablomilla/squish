import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { alwaysThinks, bindsThinking, thinkingOff } from '../server/providers';
import { bindingSafe, forClaude } from '../server/chat';
import { PRICED_MODELS, priceUsage } from '../server/pricing';

/**
 * Claude Opus 5.5 and Sonnet 5.5: on the dashboard, priced, and asked in a
 * shape they accept. Both refuse `thinking: disabled`, and both bind their
 * thinking to the conversation that produced it.
 */

test('the newer models can be chosen, and are priced at their own rates', () => {
  for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) assert.ok(PRICED_MODELS.includes(model), model);
  // $4 in, $20 out per million on Opus 5.5; its cached input is $0.20, not the usual tenth of $4.
  assert.equal(priceUsage('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 24);
  assert.equal(priceUsage('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })?.toFixed(2), '0.20');
  assert.equal(priceUsage('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 12);
  assert.equal(priceUsage('claude-sonnet-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })?.toFixed(2), '0.20');
  // The others are as they were.
  assert.equal(priceUsage('claude-opus-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })?.toFixed(2), '0.50');
});

test('thinking is turned off only where the model allows it', () => {
  for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']) {
    assert.ok(alwaysThinks(model), model);
    assert.deepEqual(thinkingOff(model), {}, `${model} would refuse thinking: disabled`);
  }
  for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-4-8']) {
    assert.ok(!alwaysThinks(model), model);
    assert.deepEqual(thinkingOff(model), { thinking: { type: 'disabled' } });
  }
});

/** A question mid-lookup whose last turn was written by Gemini: no thinking at its start. */
const midLookup = (model: string): Anthropic.MessageCreateParamsNonStreaming => ({
  model,
  max_tokens: 2400,
  thinking: { type: 'adaptive' },
  messages: [
    { role: 'user', content: 'How much protein did I have this week?' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'gm_1', name: 'diary_days', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'gm_1', content: '{}' }] },
  ],
});

test('a round Claude cannot sign goes without thinking on Opus 5, and as it is on the 5.5 models', () => {
  assert.deepEqual(forClaude(midLookup('claude-opus-5'), false).thinking, { type: 'disabled' });
  assert.deepEqual(forClaude(midLookup('claude-opus-5-5'), false).thinking, { type: 'adaptive' });
  assert.deepEqual(forClaude(midLookup('claude-sonnet-5-5'), false).thinking, { type: 'adaptive' });
});

test('on a model that binds its thinking, thinking the conversation has outgrown is dropped, not refused', () => {
  for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
    assert.ok(bindsThinking(model));
    const sent = bindingSafe(midLookup(model)) as Anthropic.Beta.MessageCreateParamsNonStreaming;
    assert.deepEqual(sent.betas, ['thinking-binding-controls-2026-08-01']);
    assert.deepEqual(sent.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
  }
  // Elsewhere the request is left exactly as it was.
  const opus5 = midLookup('claude-opus-5');
  assert.equal(bindingSafe(opus5), opus5);
});
