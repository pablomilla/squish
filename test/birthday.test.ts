import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageOn, birthDateOf, daysIn, startingBirthDate } from '../src/lib/birthday';

/**
 * A date of birth and the age it makes: the number the energy formula uses,
 * which goes up by itself on the day rather than staying what was typed.
 */
const on = (iso: string) => new Date(`${iso}T09:00:00`);

test('a birthday counts from its morning, not a day late or early', () => {
  assert.equal(ageOn('1995-02-18', on('2026-02-17')), 30);
  assert.equal(ageOn('1995-02-18', on('2026-02-18')), 31);
  assert.equal(ageOn('1995-02-18', on('2026-12-31')), 31);
  assert.equal(ageOn('2008-09-29', on('2026-09-28')), 17, 'the day before an 18th birthday is still 17');
  assert.equal(ageOn('2008-09-28', on('2026-09-28')), 18);
});

test('a leap-day birthday is still a year older after February', () => {
  assert.equal(ageOn('2000-02-29', on('2025-02-28')), 24);
  assert.equal(ageOn('2000-02-29', on('2025-03-01')), 25);
});

test('the day wheel never offers a day the month does not have', () => {
  assert.equal(daysIn(2024, 2), 29);
  assert.equal(daysIn(2025, 2), 28);
  assert.equal(daysIn(2025, 4), 30);
  assert.equal(birthDateOf(2025, 2, 31), '2025-02-28', 'moving from 31 January to February lands on its last day');
  assert.equal(birthDateOf(1990, 7, 4), '1990-07-04');
});

test('the wheel starts at the default age', () => {
  assert.equal(ageOn(startingBirthDate(30, on('2026-09-28')), on('2026-09-28')), 30);
});
