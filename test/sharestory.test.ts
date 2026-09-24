import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shareStory } from '../src/lib/shareStory';

/** A share card for every point in somebody's diary, never a row of zeros. */

const week = (loggedDays: number) => ({ days: 7, loggedDays, avgCalories: loggedDays ? 1800 : 0, avgScore: loggedDays ? 72 : 0 });

test('a streak card for two days or more, as before', () => {
  const card = shareStory({ streak: 9, best: 12, mealCount: 30, summary: week(7) });
  assert.equal(card.headline, '9 day streak');
  assert.equal(card.subline, '7 of the last 7 days logged, averaging 1800 kcal.');
  assert.deepEqual(card.stats.map((s) => s.value), ['12', '72', '30']);
  assert.equal(card.mood, 'cheering');
});

test('nothing logged yet: a welcome, with no figures at all', () => {
  const card = shareStory({ streak: 0, best: 0, mealCount: 0, summary: week(0) });
  assert.equal(card.headline, 'Starting with Squish');
  assert.deepEqual(card.stats, []);
});

test('day one, and coming back after a streak ended', () => {
  const first = shareStory({ streak: 1, best: 1, mealCount: 1, summary: week(1) });
  assert.equal(first.headline, 'Day one');
  assert.deepEqual(first.stats, [{ label: 'meal logged', value: '1' }, { label: 'avg quality', value: '72' }]);

  const back = shareStory({ streak: 0, best: 14, mealCount: 60, summary: week(2) });
  assert.equal(back.headline, 'Back with Squish');
  assert.ok(back.stats.every((s) => s.value !== '0'), 'no zeros on a card');
});
