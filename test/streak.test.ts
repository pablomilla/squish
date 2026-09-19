import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestStreak, streakForgaveADay, streakOf } from '../src/lib/selectors';
import type { MealEntry } from '../src/types';

const TODAY = '2026-09-19';
const on = (...dates: string[]): MealEntry[] => dates.map((date, i) => ({ id: String(i), date }) as MealEntry);
const back = (n: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

test('an unbroken run counts every day of it', () => {
  assert.equal(streakOf(on(back(0), back(1), back(2), back(3)), TODAY), 4);
  assert.equal(streakForgaveADay(on(back(0), back(1), back(2)), TODAY), false);
});

test('one missed day does not undo the streak', () => {
  // Logged today, yesterday, then nothing, then two before that.
  const meals = on(back(0), back(1), back(3), back(4));
  assert.equal(streakOf(meals, TODAY), 4, 'the run should carry across the gap');
  assert.equal(streakForgaveADay(meals, TODAY), true);
});

test('the missed day is forgiven, not counted', () => {
  // Four days, one of them skipped: the streak is the four that were logged.
  assert.equal(streakOf(on(back(0), back(1), back(3), back(4)), TODAY), 4);
});

test('two missed days in a row ends it', () => {
  const meals = on(back(0), back(1), back(4), back(5));
  assert.equal(streakOf(meals, TODAY), 2, 'everything before the two-day gap is a past streak');
  assert.equal(streakForgaveADay(meals, TODAY), false);
});

test('today is not held against you until it is over', () => {
  assert.equal(streakOf(on(back(1), back(2), back(3)), TODAY), 3);
});

test('a gap at the very start is not forgiven into existence', () => {
  // Nothing today or yesterday: the run ended, it did not carry on.
  assert.equal(streakOf(on(back(2), back(3)), TODAY), 0);
  assert.equal(streakForgaveADay(on(back(2), back(3)), TODAY), false);
});

test('nothing logged at all is no streak', () => {
  assert.equal(streakOf([], TODAY), 0);
  assert.equal(bestStreak([]), 0);
});

test('the best run ever is measured the same forgiving way', () => {
  // Otherwise a current streak could be longer than the best one ever.
  const meals = on(back(0), back(1), back(3), back(4));
  assert.ok(bestStreak(meals) >= streakOf(meals, TODAY), 'best must never be less than current');
  assert.equal(bestStreak(meals), 4);
});

test('a single logged day is a streak of one', () => {
  assert.equal(streakOf(on(back(0)), TODAY), 1);
  assert.equal(bestStreak(on(back(0))), 1);
});
