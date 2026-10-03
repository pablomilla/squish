import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkInDue, historyFor, isNever, lastWeekReview, logged, outcomeOf, reviewOf, stalePlans, toggleNever, LOG_MAX, type PlanOutcome } from '../src/lib/planLearning';
import { SQUISH_PLAN_NOTE } from '../src/lib/planner';
import { cleanWeekRequest, weekPlanPrompt, WEEKPLAN_SYSTEM } from '../server/weekplan';
import { toWeekPlan, withoutNever } from '../server/claude';
import type { MealEntry, MealSlot } from '../src/types';

/**
 * The learning loop: what happened to each of the nutritionist's planned
 * meals is kept, shown back once a week, and told to the next plan — more
 * like what was made, fewer like what wasn't, never what is not for them.
 */
const TODAY = '2026-09-29';
const o = (title: string, date: string, outcome: PlanOutcome['outcome'], slot: MealSlot = 'dinner'): PlanOutcome => ({ title, date, outcome, slot });
let n = 0;
const plan = (date: string, title: string, over: Partial<MealEntry> = {}): MealEntry => ({
  id: `p${n++}`, date, time: '', slot: 'dinner', title, items: [], nutrients: { calories: 500, protein: 30, carbs: 50, fat: 15, fibre: 6 }, score: 70, source: 'describe', note: SQUISH_PLAN_NOTE, ...over,
});

test('a plan two days gone without being eaten is skipped — the nutritionist’s are noted, anybody’s leaves the diary', () => {
  const plans = [plan('2026-09-26', 'Old curry'), plan('2026-09-27', 'Their own soup', { note: undefined }), plan('2026-09-28', 'Yesterday’s dinner'), plan(TODAY, 'Tonight')];
  const { stale, skipped } = stalePlans(plans, TODAY);
  assert.deepEqual(stale.map((p) => p.title), ['Old curry', 'Their own soup'], 'yesterday’s may still be logged late');
  assert.deepEqual(skipped, [o('Old curry', '2026-09-26', 'skipped')], 'only the nutritionist’s meals are judged');
});

test('the log keeps the newest, to a limit', () => {
  const log = Array.from({ length: LOG_MAX }, (_, i) => o(`Meal ${i}`, TODAY, 'made'));
  const next = logged(log, outcomeOf(plan(TODAY, '  Newest '), 'swapped'));
  assert.equal(next.length, LOG_MAX);
  assert.deepEqual(next.at(-1), o('Newest', TODAY, 'swapped'));
  assert.equal(next[0].title, 'Meal 1');
});

test('a review counts what was made, and a meal made even once is a hit, not a miss', () => {
  const log = [
    o('Chickpea curry', '2026-09-23', 'made'), o('chickpea curry', '2026-09-26', 'made'),
    o('Salmon traybake', '2026-09-24', 'skipped'), o('Salmon traybake', '2026-09-27', 'swapped'),
    o('Tuna wrap', '2026-09-25', 'made'), o('Tuna wrap', '2026-09-28', 'skipped'),
    o('Porridge', '2026-09-25', 'dropped', 'breakfast'),
    o('Long ago', '2026-08-01', 'skipped'),
  ];
  const review = lastWeekReview(log, TODAY);
  assert.equal(review.planned, 7, 'last seven days only');
  assert.equal(review.made, 3);
  assert.deepEqual(review.hits, [{ title: 'Chickpea curry', times: 2 }, { title: 'Tuna wrap', times: 1 }]);
  assert.deepEqual(review.misses, [{ title: 'Salmon traybake', times: 2, outcome: 'swapped' }, { title: 'Porridge', times: 1, outcome: 'dropped' }]);
  assert.equal(reviewOf(log, '2026-08-01', '2026-08-01').planned, 1);
});

test('the check-in is due once a week, and only with enough to say', () => {
  const review = lastWeekReview([o('A', TODAY, 'made'), o('B', TODAY, 'skipped'), o('C', TODAY, 'made')], TODAY);
  assert.equal(checkInDue(review, '', '2026-09-28'), true);
  assert.equal(checkInDue(review, '2026-09-28', '2026-09-28'), false, 'closed this week');
  assert.equal(checkInDue(review, '2026-09-21', '2026-09-28'), true, 'closed last week: due again');
  assert.equal(checkInDue(lastWeekReview([o('A', TODAY, 'made')], TODAY), '', '2026-09-28'), false);
});

test('"not for me" is kept by name and taken off again the same way', () => {
  let never = toggleNever([], ' Tuna wrap ');
  assert.deepEqual(never, ['Tuna wrap']);
  assert.equal(isNever(never, 'TUNA WRAP'), true);
  never = toggleNever(never, 'tuna wrap');
  assert.deepEqual(never, []);
});

test('the next plan is told how the last ones went — nothing until there is something to go on', () => {
  assert.equal(historyFor([o('A', TODAY, 'made')], [], TODAY), undefined, 'one meal is not a history');
  const log = [o('Chickpea curry', '2026-09-20', 'made'), o('Salmon traybake', '2026-09-21', 'skipped'), o('Tuna wrap', '2026-09-22', 'swapped'), o('Soup', '2026-09-23', 'made')];
  assert.deepEqual(historyFor(log, ['Tuna wrap'], TODAY), {
    planned: 4, made: 2, hits: ['Chickpea curry', 'Soup'], misses: ['Salmon traybake'], never: ['Tuna wrap'],
  }, 'what is never wanted is said once, as never, not as a miss too');
  assert.deepEqual(historyFor([], ['Liver'], TODAY)?.never, ['Liver'], 'a "not for me" is worth saying on its own');
});

test('the server tidies the history, tells the plan, and the rules say how to use it', () => {
  const base = { startDate: '2026-09-30', days: 3, calorieTarget: 1900, sex: 'female' };
  const req = cleanWeekRequest({ ...base, history: { planned: 9, made: 12, hits: ['Chickpea curry', ''], misses: ['Salmon traybake'], never: ['Tuna wrap'] } })!;
  assert.deepEqual(req.history, { planned: 9, made: 9, hits: ['Chickpea curry'], misses: ['Salmon traybake'], never: ['Tuna wrap'] });
  const prompt = weekPlanPrompt(req);
  assert.match(prompt, /<how_their_last_plans_went>\nThey made 9 of the 9 meals planned for them in the last few weeks\.\nMade: Chickpea curry\nSkipped or swapped: Salmon traybake\nNot for them — never plan these: Tuna wrap\n<\/how_their_last_plans_went>/);
  assert.match(WEEKPLAN_SYSTEM, /If they made fewer than half of what was planned, make this plan easier to follow/);
  assert.equal(cleanWeekRequest({ ...base, history: { planned: 0, never: [] } })!.history, undefined);
  assert.doesNotMatch(weekPlanPrompt(cleanWeekRequest(base)!), /how_their_last_plans_went/);
});

test('a meal that is not for them is taken out of the plan by name, if the model plans it anyway', () => {
  const req = cleanWeekRequest({ startDate: '2026-09-30', days: 3, calorieTarget: 1900, sex: 'female' })!;
  const item = { name: 'x', emoji: '🍽️', portion: '1', grams: 100, liquid: false, ultraProcessed: false, nutrients: { calories: 500, protein: 20, carbs: 50, fat: 10, fibre: 5, satFat: 2, sugar: 3, freeSugar: 0, sodium: 300 } };
  const week = toWeekPlan({ days: [{ day: 1, meals: [{ slot: 'lunch', title: 'Tuna Wrap', items: [item] }, { slot: 'dinner', title: 'Curry', items: [item] }] }, { day: 2, meals: [{ slot: 'lunch', title: 'tuna wrap', items: [item] }] }] }, req);
  const kept = withoutNever(week, ['Tuna wrap']);
  assert.deepEqual(kept.days.map((d) => d.meals.map((m) => m.title)), [['Curry']], 'a day left with nothing goes too');
  assert.equal(kept.days[0].calories, 500);
  assert.equal(withoutNever(week, []), week);
});
