import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ape, economics, scoreModel } from '../scripts/bench';

const fixtures = [
  { file: 'a.jpg', name: 'Porridge', calories: 400, protein: 14, carbs: 62, fat: 10 },
  { file: 'b.jpg', name: 'Burger', calories: 1000, protein: 48, carbs: 96, fat: 62 },
];

const attempt = (meal: string, calories: number, run = 1, extra: Record<string, unknown> = {}) => ({
  model: 'test-model',
  meal,
  run,
  ok: true,
  predicted: { calories, protein: 14, carbs: 62, fat: 10 },
  usage: { model: 'test-model', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, costUsd: 0.02, latencyMs: 4000 },
  ...extra,
});

test('percentage error handles a zero truth without dividing by it', () => {
  assert.equal(ape(400, 400), 0);
  assert.equal(ape(400, 500), 0.25);
  assert.equal(ape(0, 0), 0);
  assert.equal(ape(0, 120), 1);
});

test('within-20% counts the meals a user could actually trust', () => {
  const score = scoreModel('test-model', [
    attempt('Porridge', 440), // 10% out — fine
    attempt('Burger', 1300), // 30% out — not fine
  ], fixtures);

  assert.equal(score.within20, 0.5);
  assert.ok(Math.abs(score.calorieMape - 0.2) < 1e-9);
  assert.equal(score.failures, 0);
});

test('failed attempts are counted, not silently dropped from the average', () => {
  const score = scoreModel('test-model', [
    attempt('Porridge', 400),
    { model: 'test-model', meal: 'Burger', run: 1, ok: false, error: 'rejected the image' },
  ], fixtures);

  assert.equal(score.attempts, 2);
  assert.equal(score.failures, 1);
  assert.equal(score.calorieMape, 0, 'the one that succeeded was exact');
  assert.equal(score.within20, 1);
});

test('run spread exposes a model that answers differently each time', () => {
  const steady = scoreModel('test-model', [attempt('Porridge', 400, 1), attempt('Porridge', 404, 2)], fixtures);
  const jumpy = scoreModel('test-model', [attempt('Porridge', 300, 1), attempt('Porridge', 600, 2)], fixtures);

  assert.ok(steady.spread < 0.02, `steady was ${steady.spread}`);
  assert.ok(jumpy.spread > 0.6, `jumpy was ${jumpy.spread}`);
});

test('economics turn cost per photo into a monthly margin', () => {
  const result = economics(0.03, 3, 4.99);

  assert.ok(Math.abs(result.monthlyApiCost - 2.7) < 1e-9, 'three meals a day for 30 days');
  // £4.99 less Apple's 15%, less the API bill.
  assert.ok(Math.abs(result.netAtSmallBusiness - (4.99 * 0.85 - 2.7)) < 1e-9);
  assert.ok(result.netAtStandard < result.netAtSmallBusiness, 'the 30% tier nets less');
});

test('a cheap model can rescue a subscription that a dear one loses money on', () => {
  const opusish = economics(0.031, 5, 4.99);
  const haikuish = economics(0.006, 5, 4.99);

  assert.ok(opusish.netAtStandard < 0, 'a heavy user on the dear model loses money at 30%');
  assert.ok(haikuish.netAtStandard > 2, 'the cheap model keeps the same user profitable');
});

test('federation counts as credentials, so the app does not silently go offline', async () => {
  const { hasCredentials, credentialSource } = await import('../server/claude');
  const saved = { ...process.env };
  const clear = () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ANTHROPIC_')) delete process.env[key];
    }
  };

  try {
    clear();
    assert.equal(hasCredentials(), false);
    assert.equal(credentialSource(), 'none');

    // A half-configured federation is not credentials — it would fail at the API.
    process.env.ANTHROPIC_FEDERATION_RULE_ID = 'rule';
    process.env.ANTHROPIC_ORGANIZATION_ID = 'org';
    assert.equal(hasCredentials(), false, 'incomplete federation must not count');

    process.env.ANTHROPIC_SERVICE_ACCOUNT_ID = 'svc';
    process.env.ANTHROPIC_IDENTITY_TOKEN_FILE = '/var/run/token';
    assert.equal(hasCredentials(), true);
    assert.equal(credentialSource(), 'federation');

    // An explicit key outranks federation in the SDK, so it should here too.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    assert.equal(credentialSource(), 'api-key');
  } finally {
    clear();
    Object.assign(process.env, saved);
  }
});
