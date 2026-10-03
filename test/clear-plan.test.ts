import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MealEntry, MealSlot } from '../src/types';
import { OLD_SQUISH_PLAN_NOTE, SQUISH_PLAN_NOTE, currentPlan, isSquishPlan, replaceable, shownNote } from '../src/lib/planner';
import { judged } from '../src/lib/planLearning';
import { unlogged, type PlanOutcome } from '../src/lib/planLearning';
import { useSquish } from '../src/store/useSquish';
import { isoDate, addDays } from '../src/lib/date';

/**
 * Changing a whole meal plan at once: clearing it, a day of it, or the
 * meals picked — and taking any of that back.
 */
const nutrients = { calories: 500, protein: 30, carbs: 50, fat: 15, fibre: 5, sugar: 5, sodium: 400 };
const plan = (id: string, date: string, slot: MealSlot, extra: Partial<MealEntry> = {}): MealEntry =>
  ({ id, date, time: '', slot, title: `Meal ${id}`, items: [], nutrients, score: 70, source: 'manual', note: SQUISH_PLAN_NOTE, ...extra }) as MealEntry;

test('the plan as it stands: the nutritionist’s meals from today on, kept ones too', () => {
  const plans = [
    plan('a', '2026-10-02', 'dinner'),
    plan('b', '2026-10-03', 'lunch'),
    plan('c', '2026-10-05', 'dinner', { kept: true }),
    plan('d', '2026-10-04', 'dinner', { note: undefined }),
  ];
  assert.deepEqual(currentPlan(plans, '2026-10-03').map((p) => p.id), ['b', 'c'], 'not yesterday’s, and not one they planned themselves');
});

test('taking back a dropped meal takes back the note of it, once', () => {
  const dropped: PlanOutcome = { title: 'Curry', slot: 'dinner', date: '2026-10-04', outcome: 'dropped' };
  const made: PlanOutcome = { ...dropped, outcome: 'made' };
  const log = [dropped, made, dropped];
  assert.deepEqual(unlogged(log, dropped), [dropped, made], 'the newest goes, and only one');
  assert.deepEqual(unlogged([made], dropped), [made], 'nothing to take back');
});

test('clearing the plan, a day or the picked meals, and Undo', () => {
  const today = isoDate();
  const tomorrow = addDays(today, 1);
  const s = () => useSquish.getState();
  useSquish.setState({ plans: [], planLog: [] });
  for (const p of [plan('x1', today, 'lunch'), plan('x2', today, 'dinner'), plan('x3', tomorrow, 'dinner', { kept: true }), plan('mine', tomorrow, 'lunch', { note: undefined })]) s().addPlan(p);

  // A whole day, or the whole plan, says nothing about the meals.
  const day = s().dropPlans(['x1', 'x2'], false);
  assert.deepEqual(day.map((p) => p.id).sort(), ['x1', 'x2']);
  assert.deepEqual(s().plans.map((p) => p.id).sort(), ['mine', 'x3']);
  assert.equal(s().planLog.length, 0);
  s().restorePlans(day, false);
  assert.deepEqual(s().plans.map((p) => p.id).sort(), ['mine', 'x1', 'x2', 'x3'], 'Undo puts them back');

  // Picked one by one: the nutritionist's are noted as dropped, as one would be — and Undo takes that back.
  const picked = s().dropPlans(['x1', 'mine'], true);
  assert.deepEqual(s().planLog.map((o) => [o.title, o.outcome]), [['Meal x1', 'dropped']], 'only the nutritionist’s meal is judged');
  s().restorePlans(picked, true);
  assert.equal(s().planLog.length, 0);
  assert.equal(s().plans.length, 4);
  s().restorePlans(picked, true);
  assert.equal(s().plans.length, 4, 'putting back twice adds nothing twice');

  // Clearing all but the kept.
  const keepKept = currentPlan(s().plans, today).filter((p) => !p.kept).map((p) => p.id);
  s().dropPlans(keepKept, false);
  assert.deepEqual(s().plans.map((p) => p.id).sort(), ['mine', 'x3'], 'the kept one, and the one they planned themselves, stay');
  useSquish.setState({ plans: [], planLog: [] });
});

test('plans saved before Ask Squish had its name are still Squish’s, and read with the new words', () => {
  const old = plan('o', '2026-10-04', 'dinner', { note: OLD_SQUISH_PLAN_NOTE });
  const mine = plan('m', '2026-10-04', 'lunch', { note: 'Leftovers' });
  assert.equal(SQUISH_PLAN_NOTE, 'Planned by Squish');
  assert.ok(isSquishPlan(old) && isSquishPlan(plan('n', '2026-10-04', 'lunch')));
  assert.ok(!isSquishPlan(mine));
  assert.ok(replaceable(old), 'a new week still replaces it');
  assert.ok(judged(old), 'and what happens to it still teaches the next plan');
  assert.deepEqual(currentPlan([old, mine], '2026-10-03').map((p) => p.id), ['o']);
  assert.equal(shownNote(OLD_SQUISH_PLAN_NOTE), 'Planned by Squish');
  assert.equal(shownNote('Leftovers'), 'Leftovers');
});
