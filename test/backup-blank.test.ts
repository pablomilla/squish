import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBlank } from '../src/lib/blankDiary';

/**
 * The backup takes over a diary on the server only when there is nothing in
 * it to lose: never set up, and nothing logged or planned. Anything else is
 * a conflict for a person to settle.
 */
test('only a diary with nothing in it is replaced without asking', () => {
  // What an account made during onboarding was left holding, before the fix.
  assert.equal(isBlank({ profile: { name: '', onboarded: false }, meals: [] }), true);
  assert.equal(isBlank(null), true);
  assert.equal(isBlank({}), true);

  assert.equal(isBlank({ profile: { name: 'Real', onboarded: true }, meals: [] }), false, 'a set-up diary is somebody’s');
  assert.equal(isBlank({ profile: { onboarded: false }, meals: [{ id: 'm1' }] }), false, 'a logged meal is somebody’s');
  assert.equal(isBlank({ profile: { onboarded: false }, days: { '2026-09-28': { water: 3 } } }), false, 'a logged day is somebody’s');
  assert.equal(isBlank({ profile: { onboarded: false }, plans: [{ id: 'p1' }] }), false, 'a planned meal is somebody’s');
});
