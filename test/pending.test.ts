import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useSquish } from '../src/store/useSquish';
import type { Draft } from '../src/types';

/**
 * The unfinished meal.
 *
 * A meal that has been photographed and corrected is a minute of somebody's
 * attention, and it used to live only in the screen showing it — so a back
 * gesture, or a browser tab the phone reclaimed, took it with them. It is
 * kept in the store now, and the rules are narrow: it is held until it is
 * either saved or thrown away, and it is never itself a logged meal.
 */

const draft: Draft = {
  analysis: {
    title: 'Chicken katsu curry',
    items: [{ id: 'i1', name: 'Katsu', portion: '1 fillet', grams: 180, nutrients: { calories: 430, protein: 34, carbs: 22, fat: 22, fibre: 2 } }],
    nutrients: { calories: 430, protein: 34, carbs: 22, fat: 22, fibre: 2 },
    score: 62,
    coachNote: '',
    confidence: 'medium',
  },
  slot: 'lunch',
  date: '2026-05-20',
};

test('an unfinished meal is held, and is not a logged meal', () => {
  const store = useSquish.getState();
  store.setPendingMeal(draft);

  assert.equal(useSquish.getState().pendingMeal?.analysis.title, 'Chicken katsu curry');
  assert.equal(useSquish.getState().meals.length, 0, 'holding it must not log it');

  store.setPendingMeal(null);
  assert.equal(useSquish.getState().pendingMeal, null);
});

test('the note survives being put down and picked up again', () => {
  useSquish.getState().setPendingMeal({ ...draft, note: 'Half of it went cold' });
  assert.equal(useSquish.getState().pendingMeal?.note, 'Half of it went cold');
  useSquish.getState().setPendingMeal(null);
});

test('starting again throws the unfinished meal away with everything else', () => {
  useSquish.getState().setPendingMeal(draft);
  useSquish.getState().resetAll();
  // Left behind, it would reappear on a freshly wiped Home screen offering
  // somebody a meal from the diary they had just deleted.
  assert.equal(useSquish.getState().pendingMeal, null);
});
