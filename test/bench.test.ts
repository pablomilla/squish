import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ape, economics, markdownReport, plateVerdict, scoreModel } from '../scripts/bench';

const fixtures = [
  { file: 'a.jpg', name: 'Porridge', calories: 400, protein: 14, carbs: 62, fat: 10 },
  { file: 'b.jpg', name: 'Burger', calories: 1000, protein: 48, carbs: 96, fat: 62 },
];

const attempt = (meal: string, calories: number, run = 1, extra: Record<string, unknown> = {}) => ({
  model: 'test-model',
  meal,
  run,
  variant: 'default',
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
    { model: 'test-model', meal: 'Burger', run: 1, variant: 'default', ok: false, error: 'rejected the image' },
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
  // £4.99 less VAT, less Apple's 15% of what is left, less the API bill.
  assert.ok(Math.abs(result.netAtSmallBusiness - ((4.99 / 1.2) * 0.85 - 2.7)) < 1e-9);
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

/* ------------------------------------------------------------------ *
 * Portion accuracy, and whether the plate size does anything.
 * ------------------------------------------------------------------ */

const weighed = [
  { file: 'a.jpg', name: 'Porridge', calories: 400, protein: 14, carbs: 62, fat: 10, grams: 330 },
  { file: 'b.jpg', name: 'Burger', calories: 1000, protein: 48, carbs: 96, fat: 62, grams: 450 },
];

const withGrams = (meal: string, calories: number, grams: number, variant = 'default') => ({
  ...attempt(meal, calories),
  variant,
  predictedGrams: grams,
});

test('portion error is measured against what the food weighed', () => {
  const score = scoreModel('m', [withGrams('Porridge', 400, 330), withGrams('Burger', 1000, 540)], weighed);

  assert.equal(score.gramsMeals, 2);
  assert.ok(Math.abs(score.gramsMape - 0.1) < 1e-9, 'exact and 20% out averages to 10%');
  assert.equal(score.gramsWithin20, 1, 'both land inside a fifth');
});

test('a meal nobody weighed sits the portion measure out', () => {
  const mixed = [weighed[0], { ...weighed[1], grams: undefined }];
  const score = scoreModel('m', [withGrams('Porridge', 400, 330), withGrams('Burger', 1000, 900)], mixed);

  assert.equal(score.gramsMeals, 1, 'only the weighed one counts');
  assert.equal(score.gramsMape, 0, 'and the unweighed miss does not pollute it');
});

test('an unweighed set reports no portion figure rather than a made-up one', () => {
  const score = scoreModel('m', [attempt('Porridge', 400)], fixtures);
  assert.equal(score.gramsMeals, 0);
  assert.equal(score.gramsMape, 0);
});

test('calories can be right off a portion that is wrong — which is the point', () => {
  // 400 kcal exactly, from a plate it thinks is half the weight it was: the
  // calorie column says perfect, the portion column says it guessed.
  const score = scoreModel('m', [withGrams('Porridge', 400, 165)], weighed);
  assert.equal(score.calorieMape, 0, 'calories look flawless');
  assert.equal(score.gramsMape, 0.5, 'and the portion was out by half');
});

test('the plate verdict calls a real improvement a real improvement', () => {
  const before = scoreModel('m', [withGrams('Porridge', 400, 500, 'a'), withGrams('Burger', 1000, 700, 'a')], weighed, 'a');
  const after = scoreModel('m', [withGrams('Porridge', 400, 340, 'b'), withGrams('Burger', 1000, 470, 'b')], weighed, 'b');

  const v = plateVerdict(before, after);
  assert.match(v.verdict, /Better with the plate size/);
  assert.ok(v.gramsAfter < v.gramsBefore);
});

test('and calls a wash a wash rather than dressing it up', () => {
  const before = scoreModel('m', [withGrams('Porridge', 400, 360, 'a')], weighed, 'a');
  const after = scoreModel('m', [withGrams('Porridge', 400, 361, 'b')], weighed, 'b');
  assert.match(plateVerdict(before, after).verdict, /No real difference/);
});

test('and says so when it made things worse', () => {
  const before = scoreModel('m', [withGrams('Porridge', 400, 340, 'a')], weighed, 'a');
  const after = scoreModel('m', [withGrams('Porridge', 400, 500, 'b')], weighed, 'b');
  assert.match(plateVerdict(before, after).verdict, /Worse with the plate size/);
});

test('a small set is labelled a hint, not a result', () => {
  const before = scoreModel('m', [withGrams('Porridge', 400, 500, 'a')], weighed, 'a');
  const after = scoreModel('m', [withGrams('Porridge', 400, 340, 'b')], weighed, 'b');
  assert.match(plateVerdict(before, after).verdict, /hint rather than a result/);
});

test('with nothing weighed the verdict falls back to calories and says which', () => {
  const before = scoreModel('m', [attempt('Porridge', 600)], fixtures, 'a');
  const after = scoreModel('m', [attempt('Porridge', 410)], fixtures, 'b');

  const v = plateVerdict(before, after);
  assert.equal(v.weighedMeals, 0);
  assert.match(v.verdict, /calorie error/);
});

test('the report leads with the plate comparison when there are two arms', () => {
  const attempts = [
    { ...withGrams('Porridge', 520, 500, 'no plate size'), model: 'claude-opus-5' },
    { ...withGrams('Porridge', 410, 335, 'with plate size'), model: 'claude-opus-5' },
  ];
  const before = scoreModel('claude-opus-5', [attempts[0]], weighed, 'no plate size');
  const after = scoreModel('claude-opus-5', [attempts[1]], weighed, 'with plate size');

  const report = markdownReport([before, after], [weighed[0]], attempts, 4.99);

  assert.match(report, /## Does telling Squish your plate size help\?/);
  assert.match(report, /Portion error, no plate/);
  assert.match(report, /Better with the plate size/);
  assert.match(report, /330 g on the plate/, 'the per-meal section states what it weighed');
  assert.match(report, /\| claude-opus-5 \| no plate size \|/, 'and the arm is a column');
});

test('a single-arm report keeps its old shape, with no empty arm column', () => {
  const score = scoreModel('claude-opus-5', [attempt('Porridge', 410)], fixtures);
  const report = markdownReport([score], [fixtures[0]], [attempt('Porridge', 410)], 4.99);

  assert.doesNotMatch(report, /Does telling Squish your plate size help/);
  assert.doesNotMatch(report, /\| Arm \|/);
  assert.match(report, /## Accuracy and cost/);
  assert.match(report, /## What a user costs/);
});

test('the economics table is not doubled by the comparison arms', () => {
  const before = scoreModel('claude-opus-5', [withGrams('Porridge', 410, 335, 'a')], weighed, 'a');
  const after = scoreModel('claude-opus-5', [withGrams('Porridge', 410, 335, 'b')], weighed, 'b');
  const report = markdownReport([before, after], [weighed[0]], [], 4.99);

  const costSection = report.slice(report.indexOf('## What a user costs'), report.indexOf('## Per meal'));
  const rows = costSection.split('\n').filter((line) => line.includes('claude-opus-5'));
  assert.equal(rows.length, 1, 'one row per model, not one per arm');
});
