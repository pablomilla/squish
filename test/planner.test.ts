import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ideasFor, planDays, plansOn, remainingToday, PLAN_DAYS_AHEAD } from '../src/lib/planner';
import type { FoodItem, MealEntry, MealSlot, Nutrients, Targets } from '../src/types';

/**
 * Planning: plans for a day, what is left of today, and ideas drawn from
 * somebody's own food. The rules that matter most: nothing when the day is
 * nearly done, nothing that does not fit, nothing already eaten today.
 */
const TODAY = '2026-09-26';
const targets = { calories: 2000, protein: 120, fibre: 30, water: 8 } as Targets;
const n = (calories: number, protein: number): Nutrients => ({ calories, protein, carbs: 40, fat: 15, fibre: 6 });
let i = 0;
const meal = (date: string, title: string, nutrients: Nutrients, over: Partial<MealEntry> = {}): MealEntry => ({
  id: `m${i++}`, date, time: '12:00', slot: 'lunch' as MealSlot, title,
  items: [{ id: `f${i}`, name: title, portion: '1', nutrients }], nutrients, score: 70, source: 'describe', ...over,
});

test('plans for a day come in meal order, and the plan window is today plus a week', () => {
  const plans = [meal(TODAY, 'Curry', n(700, 35), { slot: 'dinner' }), meal(TODAY, 'Porridge', n(350, 12), { slot: 'breakfast' }), meal('2026-09-27', 'Soup', n(300, 10))];
  assert.deepEqual(plansOn(plans, TODAY).map((p) => p.title), ['Porridge', 'Curry']);
  const days = planDays(TODAY);
  assert.equal(days.length, PLAN_DAYS_AHEAD + 1);
  assert.deepEqual([days[0], days[1], days.at(-1)], [TODAY, '2026-09-27', '2026-10-03']);
});

test('what is left of today never goes below nought', () => {
  assert.deepEqual(remainingToday([meal(TODAY, 'Big lunch', n(1500, 60))], targets, TODAY), { calories: 500, protein: 60 });
  assert.deepEqual(remainingToday([meal(TODAY, 'Feast', n(2600, 150))], targets, TODAY), { calories: 0, protein: 0 });
});

test('ideas come from their own meals and saved foods, fit what is left, and put protein first', () => {
  const history = [
    meal('2026-09-20', 'Salmon traybake', n(620, 45)),
    meal('2026-09-21', 'Chicken wrap', n(550, 38)),
    meal('2026-09-22', 'Pasta bake', n(980, 30)), // too big for 700 left
    meal('2026-09-23', 'Crisps', n(130, 2)), // too small to be an answer
    meal('2026-09-24', 'Veggie chilli', n(480, 18)),
  ];
  const today = [meal(TODAY, 'Breakfast', n(700, 25)), meal(TODAY, 'Lunch', n(600, 30))];
  const saved: FoodItem[] = [{ id: 's1', name: 'Greek yoghurt bowl', portion: '1 bowl', nutrients: n(320, 28) }];
  const ideas = ideasFor([...history, ...today], saved, targets, TODAY);
  assert.deepEqual(ideas.map((idea) => idea.title), ['Salmon traybake', 'Chicken wrap', 'Greek yoghurt bowl']);
  assert.equal(ideas[0].why, 'good for protein');
  assert.equal(ideas[2].from, 'saved');
});

test('nothing already eaten today, and each meal once however often it was eaten', () => {
  const history = [meal('2026-09-20', 'Chicken wrap', n(550, 38)), meal('2026-09-21', 'Chicken wrap', n(550, 38)), meal('2026-09-22', 'Chicken Wrap ', n(550, 38))];
  assert.equal(ideasFor(history, [], targets, TODAY).length, 1);
  assert.equal(ideasFor([...history, meal(TODAY, 'chicken wrap', n(550, 38))], [], targets, TODAY).length, 0);
});

test('no ideas when the day is nearly done — and none from long ago', () => {
  const history = [meal('2026-09-20', 'Salmon traybake', n(620, 45))];
  assert.equal(ideasFor([...history, meal(TODAY, 'Feast', n(1850, 90))], [], targets, TODAY).length, 0);
  assert.equal(ideasFor([meal('2026-06-01', 'Old favourite', n(600, 40))], [], targets, TODAY).length, 0);
});

test('a plan is not a meal until it is eaten, and then it is logged once', async () => {
  const { useSquish } = await import('../src/store/useSquish');
  const { isoDate, addDays } = await import('../src/lib/date');
  const store = useSquish.getState();
  store.resetAll();
  const today = isoDate();

  const later = store.addPlan({ ...meal(addDays(today, 2), 'Curry night', n(750, 40), { slot: 'dinner' }), id: undefined });
  const tonight = store.addPlan({ ...meal(today, 'Stir-fry', n(600, 35), { slot: 'dinner' }), id: undefined });
  const missed = store.addPlan({ ...meal(addDays(today, -1), 'Soup', n(300, 12), { time: '13:00' }), id: undefined });
  assert.equal(useSquish.getState().meals.length, 0, 'planning logs nothing');
  assert.equal(useSquish.getState().plans.length, 3);

  const eaten = useSquish.getState().eatPlan(tonight.id)!;
  assert.equal(eaten.date, today);
  assert.equal(eaten.title, 'Stir-fry');
  assert.notEqual(eaten.id, tonight.id, 'a fresh meal, not the plan under a new name');

  // Eaten early: a plan for later in the week, had today, is logged today.
  assert.equal(useSquish.getState().eatPlan(later.id)!.date, today);
  // A plan whose day has passed is logged on that day, at the time planned.
  const back = useSquish.getState().eatPlan(missed.id)!;
  assert.deepEqual([back.date, back.time], [addDays(today, -1), '13:00']);

  assert.equal(useSquish.getState().plans.length, 0);
  assert.equal(useSquish.getState().meals.length, 3);
  assert.equal(useSquish.getState().eatPlan('gone'), undefined);
  useSquish.getState().resetAll();
});

test('what they like: most-logged meals of the last month first, then saved foods, each once', async () => {
  const { likesFrom } = await import('../src/lib/planner');
  const history = [
    meal('2026-09-20', 'Chicken wrap', n(550, 38)), meal('2026-09-21', 'chicken wrap', n(550, 38)),
    meal('2026-09-22', 'Veggie chilli', n(480, 18)), meal('2026-07-01', 'Old soup', n(300, 10)),
  ];
  const saved: FoodItem[] = [{ id: 's', name: 'Greek yoghurt bowl', portion: '1', nutrients: n(320, 26) }, { id: 't', name: 'Veggie Chilli', portion: '1', nutrients: n(480, 18) }];
  assert.deepEqual(likesFrom(history, saved, TODAY), ['Chicken wrap', 'Veggie chilli', 'Greek yoghurt bowl']);
});
