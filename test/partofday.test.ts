import assert from 'node:assert/strict';
import { test } from 'node:test';
import { greeting, partOfDay, timeOfDayWords } from '../src/lib/date';

const at = (h: number, m = 0) => new Date(2026, 8, 23, h, m);

test('the part of the day follows the clock', () => {
  assert.equal(partOfDay(at(7)), 'morning');
  assert.equal(partOfDay(at(11, 59)), 'morning');
  assert.equal(partOfDay(at(12)), 'afternoon');
  assert.equal(partOfDay(at(18)), 'evening');
  assert.equal(partOfDay(at(22)), 'night');
  assert.equal(partOfDay(at(2)), 'night');
});

test('ten at night is not morning, however quiet the day', () => {
  assert.equal(greeting(at(22)), 'Good evening!');
  assert.equal(timeOfDayWords(at(22, 5)), 'late at night, 22:05');
  assert.equal(timeOfDayWords(at(8, 30)), 'morning, 08:30');
});

test('the coach is told the real time, and a note goes stale when the part of the day changes', async () => {
  const { readFileSync } = await import('node:fs');
  const home = readFileSync('src/screens/Home.tsx', 'utf8');
  assert.match(home, /timeOfDay: timeOfDayWords\(\)/, 'the coach is told a meal slot rather than the time');
  assert.match(home, /lastCoachNote\.part === part/, 'a morning note would survive into the evening');
});
