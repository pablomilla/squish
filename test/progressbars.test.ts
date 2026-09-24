import assert from 'node:assert/strict';
import { test } from 'node:test';
import { progressBars } from '../src/lib/progressBars';
import { addDays } from '../src/lib/date';
import type { DaySeriesPoint } from '../src/lib/selectors';

/** Weekly, monthly and all time each show their own thing — they used to all show the last fortnight. */

const day = (date: string, calories: number): DaySeriesPoint => ({
  date, calories, protein: calories / 20, carbs: 0, fat: 0, fibre: 0, sugar: 0, salt: 0, score: calories ? 70 : 0, logged: calories > 0,
});
const days = (count: number, end = '2026-09-24', kcal = (i: number) => 2000 + i) =>
  Array.from({ length: count }, (_, i) => day(addDays(end, i - count + 1), kcal(i)));

test('weekly is seven daily bars, lettered', () => {
  const { grain, bars } = progressBars(days(7), '7');
  assert.equal(grain, 'day');
  assert.equal(bars.length, 7);
  assert.ok(bars.every((b) => b.label.length === 1));
});

test('monthly is thirty daily bars, labelled once a week so they do not crowd', () => {
  const { grain, bars } = progressBars(days(30), '30');
  assert.equal(grain, 'day');
  assert.equal(bars.length, 30);
  assert.equal(bars.filter((b) => b.label).length, 5);
  assert.ok(bars[29].label, 'the newest bar is not named');
});

test('all time, up to half a year, is weekly averages', () => {
  const { grain, bars } = progressBars(days(60), 'all');
  assert.equal(grain, 'week');
  assert.ok(bars.length >= 9 && bars.length <= 10);
  assert.match(bars[0].title, /^Week of /);
});

test('all time, beyond half a year, is monthly averages', () => {
  const { grain, bars } = progressBars(days(400), 'all');
  assert.equal(grain, 'month');
  assert.ok(bars.length >= 13 && bars.length <= 15);
  assert.match(bars[bars.length - 1].title, /September 2026/);
});

test('a week is averaged over the days logged, not dragged down by the empty ones', () => {
  // Monday 21 to Sunday 27 September 2026: two logged days of 2,000 and 1,800.
  const week = days(7, '2026-09-27', (i) => (i === 0 ? 2000 : i === 3 ? 1800 : 0));
  const { bars } = progressBars(week, 'all');
  assert.equal(bars.length, 1);
  assert.equal(bars[0].calories, 1900);
  assert.equal(bars[0].logged, true);
});

test('a week with nothing logged is an empty bar, not a zero that looks like fasting', () => {
  const quiet = days(14, '2026-09-27', (i) => (i < 7 ? 0 : 2000));
  const { bars } = progressBars(quiet, 'all');
  assert.equal(bars[0].logged, false);
  assert.equal(bars[0].calories, 0);
});
