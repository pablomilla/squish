import assert from 'node:assert/strict';
import { test } from 'node:test';
import { earliestOffset, periodDays, periodLabel } from '../src/lib/period';

/** Insights' calendar weeks and months, and how far back its arrows go. */
const today = '2026-09-30'; // a Wednesday

test('a week runs Monday to Sunday, stepping back a week at a time', () => {
  assert.deepEqual(periodDays('week', 0, today), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(periodDays('week', 1, today)[0], '2026-09-21');
  assert.equal(periodDays('week', 1, today)[6], '2026-09-27');
  assert.equal(periodDays('week', 40, today)[0], '2025-12-22', 'across a new year');
});

test('a month is the calendar month, leap years and all', () => {
  const september = periodDays('month', 0, today);
  assert.equal(september.length, 30);
  assert.equal(september[0], '2026-09-01');
  assert.equal(september[29], '2026-09-30');
  assert.equal(periodDays('month', 1, today).length, 31, 'August');
  assert.equal(periodDays('month', 9, today)[0], '2025-12-01', 'back over the year');
  assert.equal(periodDays('month', 1, '2024-03-15').length, 29, 'February in a leap year');
});

test('the arrows go back as far as the period of the first meal, and no further', () => {
  assert.equal(earliestOffset('week', undefined, today), 0, 'nothing logged: this week only');
  assert.equal(earliestOffset('week', '2026-09-28', today), 0, 'first meal this week');
  assert.equal(earliestOffset('week', '2026-09-27', today), 1, 'the Sunday before is last week');
  assert.equal(earliestOffset('week', '2026-09-14', today), 2);
  assert.equal(earliestOffset('month', '2026-09-01', today), 0);
  assert.equal(earliestOffset('month', '2026-08-31', today), 1);
  assert.equal(earliestOffset('month', '2025-11-20', today), 10);
});

test('the label names the period plainly', () => {
  assert.equal(periodLabel('week', 0, today), 'This week');
  assert.equal(periodLabel('week', 1, today), 'Last week');
  assert.match(periodLabel('week', 2, today), /14.*20/);
  assert.equal(periodLabel('month', 0, today), 'This month');
  assert.equal(periodLabel('month', 1, today), 'Last month');
  assert.match(periodLabel('month', 2, today), /^July$/);
  assert.match(periodLabel('month', 10, today), /November.*2025/);
});
