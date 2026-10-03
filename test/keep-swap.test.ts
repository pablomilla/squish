import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase } from '../server/db';
import { fitSwap, fitToTarget, swapMeal, TEXT_MODEL, toWeekPlan, withoutKept } from '../server/claude';
import { cleanSwapRequest, cleanWeekRequest, keptCalories, seasoningPrompt, swapPrompt, toSeasoning, weekPlanPrompt, SEASONING_SYSTEM, WEEKPLAN_SYSTEM } from '../server/weekplan';
import type { About } from '../src/lib/eating';
import { FEATURES } from '../server/routing';
import { SQUISH_PLAN_NOTE, likesFrom, replaceable, replacedOn, standingOn, weekDates } from '../src/lib/planner';
import type { MealEntry, MealSlot, Nutrients } from '../src/types';

/**
 * Changing a plan without planning again. Keep a meal and a new week leaves
 * it where it is, plans the rest of the day around it, and plans more like
 * it; swap one and the new meal is sized to the old, so the day still adds up
 * and never goes over.
 */

// A stand-in Messages API that answers with `reply` and keeps each request.
const requests: Record<string, unknown>[] = [];
let reply: Record<string, unknown> = {};
let api: Server;

before(async () => {
  api = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = JSON.parse(body) as Record<string, unknown>;
      requests.push(request);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model: request.model, stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: JSON.stringify(reply) }],
          usage: { input_tokens: 1500, output_tokens: 600 },
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

const base = { startDate: '2026-09-28', days: 3, calorieTarget: 1900, proteinTarget: 130, fibreTarget: 27, goal: 'lose', sex: 'female' };
const item = (name: string, calories: number) => ({
  name, emoji: '🍽️', portion: '1 portion', grams: 100, liquid: false, ultraProcessed: false,
  nutrients: { calories, protein: 20, carbs: 30, fat: 10, fibre: 5, satFat: 3, sugar: 4, freeSugar: 0, sodium: 300 },
});

/* ---------------- Keep: the server ---------------- */

test('kept meals are tidied: only on the days planned, one per slot, with calories that could be true', () => {
  const req = cleanWeekRequest({
    ...base,
    kept: [
      { date: '2026-09-29', slot: 'dinner', title: 'Chickpea curry', calories: 560.4 },
      { date: '2026-09-29', slot: 'dinner', title: 'A second dinner', calories: 500 },
      { date: '2026-10-05', slot: 'lunch', title: 'After the plan ends', calories: 400 },
      { date: '2026-09-27', slot: 'lunch', title: 'Before it starts', calories: 400 },
      { date: '2026-09-30', slot: 'elevenses', title: 'No such slot', calories: 200 },
      { date: '2026-09-30', slot: 'snack', title: 'Apple', calories: 80 },
      { date: '2026-09-30', slot: 'lunch', title: 'Feast', calories: 9000 },
      'soup',
    ],
  })!;
  assert.deepEqual(req.kept, [
    { date: '2026-09-29', slot: 'dinner', title: 'Chickpea curry', calories: 560 },
    { date: '2026-09-30', slot: 'snack', title: 'Apple', calories: 80 },
  ]);
  assert.deepEqual(keptCalories(req), { '2026-09-29': 560, '2026-09-30': 80 });
  assert.equal(cleanWeekRequest(base)!.kept, undefined, 'an app from before sends none');
});

test('the prompt says what is already decided, by day, and the rules say to plan around it', () => {
  const req = cleanWeekRequest({ ...base, kept: [{ date: '2026-09-29', slot: 'dinner', title: 'Chickpea curry', calories: 560 }] })!;
  assert.match(weekPlanPrompt(req), /<already_decided>\n- Day 2 \(2026-09-29\), dinner: Chickpea curry, 560 kcal\n<\/already_decided>/);
  assert.doesNotMatch(weekPlanPrompt(cleanWeekRequest(base)!), /already_decided/);
  assert.match(WEEKPLAN_SYSTEM, /Leave those slots out on those days/);
});

test('a meal planned into a kept slot is dropped, and each day is fitted to what the kept meals leave of its target', () => {
  const req = cleanWeekRequest({
    ...base,
    kept: [
      { date: '2026-09-29', slot: 'dinner', title: 'Chickpea curry', calories: 600 },
      { date: '2026-09-30', slot: 'breakfast', title: 'Porridge', calories: 400 },
      { date: '2026-09-30', slot: 'lunch', title: 'Big lunch', calories: 800 },
      { date: '2026-09-30', slot: 'dinner', title: 'Big dinner', calories: 900 },
    ],
  })!;
  const day = (n: number, meals: [MealSlot, number][]) => ({ day: n, meals: meals.map(([slot, kcal]) => ({ slot, title: `${slot} ${n}`, items: [item(slot, kcal)] })) });
  const planned = toWeekPlan(
    {
      days: [
        day(1, [['breakfast', 400], ['lunch', 600], ['dinner', 800]]),
        // The model planned a dinner anyway: it goes, and the rest of the day gets 1,900 − 600.
        day(2, [['breakfast', 500], ['lunch', 800], ['dinner', 700]]),
        // Every slot kept, and more than the target already: nothing planned beside them.
        day(3, [['snack', 200]]),
      ],
    },
    req,
  );
  const { plan } = fitToTarget(withoutKept(planned, req.kept), req.calorieTarget, 1200, keptCalories(req));

  assert.deepEqual(plan.days.map((d) => d.date), ['2026-09-28', '2026-09-29'], 'a day the kept meals fill is not planned into');
  const tuesday = plan.days[1];
  assert.deepEqual(tuesday.meals.map((m) => m.slot), ['breakfast', 'lunch'], 'no second dinner');
  assert.ok(tuesday.calories <= 1300 && tuesday.calories >= 1290, `planned meals take what the curry leaves: ${tuesday.calories}`);
  assert.equal(tuesday.underFloor, false, 'the kept curry counts towards the floor');
  assert.equal(plan.days[0].calories, 1800, 'a day with nothing kept is as before');

  const light = fitToTarget(withoutKept(toWeekPlan({ days: [day(2, [['breakfast', 300]])] }, req), req.kept), 1900, 1200, keptCalories(req)).plan;
  assert.equal(light.days[0].calories, 300, 'too far short to scale up: shown as it came');
  assert.equal(light.days[0].underFloor, true, '300 planned and 600 kept is still under the floor, and still said');
});

/* ---------------- Keep: the app ---------------- */

let n = 0;
const nut = (calories: number): Nutrients => ({ calories, protein: 30, carbs: 40, fat: 15, fibre: 6 });
const plan = (date: string, slot: MealSlot, title: string, over: Partial<MealEntry> = {}): MealEntry => ({
  id: `p${n++}`, date, time: '12:00', slot, title, items: [], nutrients: nut(500), score: 70, source: 'describe', note: SQUISH_PLAN_NOTE, ...over,
});

test('a new week replaces what the nutritionist planned on its days — not kept meals, and not their own', () => {
  const plans = [
    plan('2026-09-29', 'dinner', 'Chickpea curry', { kept: true }),
    plan('2026-09-29', 'lunch', 'Soup'),
    plan('2026-09-30', 'lunch', 'Their own sandwich', { note: undefined }),
    plan('2026-10-10', 'dinner', 'Later on'),
  ];
  const dates = weekDates('2026-09-28', 3);
  assert.deepEqual(dates, ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.deepEqual(replacedOn(plans, dates).map((p) => p.title), ['Soup']);
  assert.deepEqual(standingOn(plans, dates), [
    { date: '2026-09-29', slot: 'dinner', title: 'Chickpea curry', calories: 500 },
    { date: '2026-09-30', slot: 'lunch', title: 'Their own sandwich', calories: 500 },
  ]);
  assert.equal(replaceable(plans[0]), false);
  assert.equal(replaceable(plans[1]), true);
  assert.equal(replaceable(plans[2]), false, 'a plan they made themselves is never the nutritionist’s to replace');
});

test('kept meals lead what the nutritionist is told they like, once each', () => {
  const eaten = [plan('2026-09-20', 'lunch', 'Chicken wrap', { note: undefined }), plan('2026-09-21', 'lunch', 'Chicken wrap', { note: undefined })];
  const plans = [plan('2026-09-29', 'dinner', 'Chickpea curry', { kept: true }), plan('2026-09-30', 'dinner', 'chickpea curry', { kept: true }), plan('2026-09-30', 'lunch', 'Soup')];
  assert.deepEqual(likesFrom(eaten, [], '2026-09-26', 15, plans), ['Chickpea curry', 'Chicken wrap']);
  assert.deepEqual(likesFrom(eaten, [], '2026-09-26'), ['Chicken wrap'], 'no plans passed: as before');
});

/* ---------------- Swap ---------------- */

const SWAP = { date: '2026-09-29', slot: 'dinner', title: 'Salmon traybake', calories: 620, protein: 42, dayMeals: ['Porridge', 'Soup'], avoid: ['Chickpea curry', ''], goal: 'lose', sex: 'female', notes: ['Allergic to peanuts'] };

test('a swap is tidied, and refused when there is nothing to size a meal to', () => {
  const ask = cleanSwapRequest(SWAP)!;
  assert.deepEqual([ask.slot, ask.calories, ask.protein, ask.avoid], ['dinner', 620, 42, ['Chickpea curry']]);
  assert.equal(cleanSwapRequest({ ...SWAP, calories: 20 }), null, 'not a meal');
  assert.equal(cleanSwapRequest({ ...SWAP, calories: 'lots' }), null);
  assert.equal(cleanSwapRequest({ ...SWAP, slot: 'brunch' }), null);
  assert.equal(cleanSwapRequest({ ...SWAP, title: '' }), null);
});

test('the swap prompt asks for one different meal of that size, and names everything not to offer', () => {
  const prompt = swapPrompt(cleanSwapRequest(SWAP)!);
  assert.match(prompt, /plan one dinner to swap into a plan they already have, in place of "Salmon traybake"/);
  assert.match(prompt, /about 620 kcal and 42 g protein/);
  assert.match(prompt, /<not_these>\n- Salmon traybake\n- Chickpea curry\n<\/not_these>/);
  assert.match(prompt, /- Porridge\n- Soup/);
  assert.match(prompt, /Allergic to peanuts/);
});

test('the new meal goes in the slot asked for, sized to — never over — the meal it replaces', () => {
  const ask = cleanSwapRequest(SWAP)!;
  const big = fitSwap({ days: [{ day: 1, meals: [{ slot: 'lunch', title: 'Bean chilli', items: [item('beans', 500), item('rice', 400)] }] }] }, ask);
  assert.equal(big.slot, 'dinner', 'a dinner, whatever slot it came back under');
  assert.ok(big.nutrients.calories <= 620 && big.nutrients.calories >= 610, `sized down to the old meal: ${big.nutrients.calories}`);
  assert.equal(big.items[0].grams, 69, 'portions and all');
  const close = fitSwap({ days: [{ day: 1, meals: [{ slot: 'dinner', title: 'Omelette', items: [item('eggs', 580)] }] }] }, ask);
  assert.equal(close.nutrients.calories, 580, 'a little under is left as it is');
  assert.throws(() => fitSwap({ days: [{ day: 1, meals: [{ slot: 'dinner', title: 'Nothing', items: [] }] }] }, ask), /could not find another meal/);
  assert.throws(() => fitSwap({}, ask), /could not find another meal/);
});

test('a swap is asked of the cheaper text model first, without thinking, under the weekly plan’s rules', async () => {
  assert.equal(FEATURES.find((f) => f.id === 'swap')?.defaults[0], TEXT_MODEL);
  requests.length = 0;
  reply = { summary: '', days: [{ day: 1, meals: [{ slot: 'dinner', title: 'Bean chilli', items: [{ ...item('kidney beans', 700), aisle: 'tins-jars', lookup: '' }] }] }] };
  const meal = await swapMeal(cleanSwapRequest(SWAP)!);
  assert.equal(meal.title, 'Bean chilli');
  assert.ok(meal.nutrients.calories <= 620);
  const request = requests.find((r) => String(r.system).startsWith(WEEKPLAN_SYSTEM.slice(0, 40))) as { model: string; thinking?: { type: string }; output_config?: { effort?: string } };
  assert.equal(request.model, TEXT_MODEL);
  assert.deepEqual(request.thinking, { type: 'disabled' });
  assert.equal(request.output_config?.effort, 'low');
});

test('a plan lists what a meal is flavoured with, above all what its title names', () => {
  // A "Crispy Paprika Chicken" came back with no paprika: spices weigh almost nothing, so they were left off,
  // and the recipe and the shopping list are made from the items alone.
  assert.match(WEEKPLAN_SYSTEM, /every spice, dried herb, paste and sauce it uses/);
  assert.match(WEEKPLAN_SYSTEM, /the paprika in a paprika chicken/);
  assert.match(WEEKPLAN_SYSTEM, /Salt and black pepper too, whenever the meal is seasoned with them/);
  assert.match(WEEKPLAN_SYSTEM, /Only water goes unlisted/);
});

test('what the seasoning check adds is small, new and for a meal that exists', () => {
  const meals = [{ title: 'Crispy Paprika Chicken', items: ['Chicken breast', 'Potato wedges'] }, { title: 'Herb Omelette', items: ['Eggs', 'Mixed herbs'] }];
  const add = (name: string, grams: number, extra: Record<string, unknown> = {}) => ({ name, emoji: '🌶️', portion: '1 tsp', grams, liquid: false, aisle: 'cupboard', lookup: '', ...extra });
  const found = toSeasoning({
    meals: [
      { meal: 1, add: [add('Smoked paprika', 2), add('smoked paprika', 2), add('Chicken breast', 5), add('Oven chips', 200), add('Garlic', 0), add('Salt', 1, { aisle: 'jewellery' })] },
      { meal: 2, add: [add('Salt', 1), add('Pepper', 0.5), add('Chives', 3), add('Parsley', 3), add('Paprika', 1)] },
      { meal: 3, add: [add('Salt', 1)] },
      { meal: 'first', add: [add('Salt', 1)] },
    ],
  }, meals);
  assert.deepEqual(found.get(0)!.map((i) => i.name), ['Smoked paprika', 'Salt'], 'once each; nothing already there, too big, weightless');
  assert.equal(found.get(0)![1].aisle, 'cupboard', 'an aisle that is not one is the cupboard');
  assert.equal(found.get(1)!.length, 4, 'a few at most');
  assert.equal(found.size, 2, 'no meal that is not on the list');
  assert.equal(toSeasoning(null, meals).size, 0);
  assert.equal(toSeasoning({ meals: 'none' }, meals).size, 0);
});

test('the seasoning check says what to look for and what never to add', () => {
  assert.match(SEASONING_SYSTEM, /the paprika in "Crispy Paprika Chicken"/);
  assert.match(SEASONING_SYSTEM, /salt and black pepper on a grilled steak, a baked potato/);
  assert.match(SEASONING_SYSTEM, /avoid, are allergic or intolerant to/);
  const prompt = seasoningPrompt([{ title: 'Satay Chicken', items: ['Chicken thigh', 'Rice'] }], { notes: ['Peanut allergy'], about: { diet: 'vegetarian' } as About });
  assert.match(prompt, /1\. Satay Chicken: Chicken thigh, Rice/);
  assert.match(prompt, /Peanut allergy/);
  assert.match(prompt, /<how_they_eat>/);
});
