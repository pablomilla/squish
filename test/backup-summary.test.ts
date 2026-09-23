import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summariseDiary } from '../src/lib/diarySummary';

/** Choosing between two diaries: how many meals in each, and when each was last used. */

test('counts meals and finds the latest day', () => {
  const summary = summariseDiary({
    meals: [{ date: '2026-09-01' }, { date: '2026-09-22' }, { date: '2026-09-10' }],
  });
  assert.deepEqual(summary, { meals: 3, latest: '2026-09-22' });
});

test('an empty or unrecognisable diary is nothing, not an error', () => {
  assert.deepEqual(summariseDiary({ meals: [] }), { meals: 0, latest: null });
  assert.deepEqual(summariseDiary(null), { meals: 0, latest: null });
  assert.deepEqual(summariseDiary({ meals: 'nope' }), { meals: 0, latest: null });
  assert.deepEqual(summariseDiary({ meals: [null, { date: 'yesterday' }] }), { meals: 2, latest: null });
});
