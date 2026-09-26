import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestedQuestions } from '../src/lib/askSuggestions';
import { addDays } from '../src/lib/date';
import type { MealEntry, MealSlot, Nutrients, Targets } from '../src/types';

/** The questions offered are about their day and their week, and there are always some. */
const TODAY = '2026-09-26';
const targets = { calories: 2000, protein: 120, fibre: 30 } as Targets;
const n = (calories: number, protein: number, fibre = 6): Nutrients => ({ calories, protein, carbs: 50, fat: 15, fibre });
let i = 0;
const meal = (date: string, title: string, nutrients: Nutrients): MealEntry => ({
  id: `m${i++}`, date, time: `1${i % 10}:00`, slot: 'lunch' as MealSlot, title, items: [], nutrients, score: 60, source: 'describe',
});

test('an empty diary still gets questions worth asking', () => {
  assert.deepEqual(suggestedQuestions([], targets, TODAY, 9), ['What am I short of?', 'Is my protein getting better?', 'When did I last eat fish?']);
});

test('in the afternoon, about today: dinner with what is left, the protein gap, the last meal', () => {
  const qs = suggestedQuestions([meal(TODAY, 'Tuna sandwich', n(900, 40))], targets, TODAY, 17, 4);
  assert.deepEqual(qs, ['What should I have for dinner with 1,100 kcal left?', 'How can I get 80 g more protein today?', 'Was my tuna sandwich a good choice?', 'What am I short of?']);
});

test('no dinner question late at night, and none about protein already met', () => {
  const qs = suggestedQuestions([meal(TODAY, 'Big lunch', n(1200, 110))], targets, TODAY, 22, 5);
  assert.ok(!qs.some((q) => /dinner|more protein/.test(q)), qs.join(' | '));
});

test('a logged week brings the week, and fibre when it has been low', () => {
  const week = [1, 2, 3, 4].map((back) => meal(addDays(TODAY, -back), 'Pasta', n(700, 30, 5)));
  const qs = suggestedQuestions(week, targets, TODAY, 9, 3);
  assert.deepEqual(qs.slice(0, 2), ['How was my week?', 'How can I eat more fibre?']);
});
