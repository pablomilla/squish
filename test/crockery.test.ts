import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SYSTEM, crockeryNote } from '../server/claude';
import { DEFAULT_PROFILE, clearAssumedCrockery, migrate } from '../src/store/useSquish';
import type { Targets } from '../src/types';

test('a plate of known size becomes the ruler in the prompt', () => {
  assert.match(crockeryNote({ plateCm: 27 }), /27 cm across/);
  assert.match(crockeryNote({ bowlMl: 400 }), /400 ml/);
  assert.match(crockeryNote({ plateCm: 27, bowlMl: 400 }), /27 cm across and their usual bowl holds about 400 ml/);
  assert.match(crockeryNote({ plateCm: 27 }), /^Their dinner plate/, 'stated as what we know, not as what they said');
  assert.match(crockeryNote({ plateCm: 27 }), /use that as the scale/i);
});

test('nothing measured means nothing said, rather than an empty sentence', () => {
  assert.equal(crockeryNote(), '');
  assert.equal(crockeryNote({}), '');
  assert.equal(crockeryNote({ plateCm: undefined, bowlMl: undefined }), '');
});

test('the prompt carries objects of known size, which is the whole trick', () => {
  for (const pattern of [/fork is about 19 cm/, /teaspoon 13 cm/, /mug holds 300 ml/, /can 330 ml/, /credit card is 8\.6 cm/]) {
    assert.match(SYSTEM, pattern);
  }
  assert.match(SYSTEM, /Look for something of known size in the frame/i);
  assert.match(SYSTEM, /best ruler in the picture/i);
});

/* ------------------------------------------------------------------ *
 * Nothing measured, nothing claimed.
 * ------------------------------------------------------------------ */

test('a new profile carries no plate size at all', () => {
  assert.equal(DEFAULT_PROFILE.plateCm, undefined, 'a wrong ruler is worse than no ruler');
  assert.equal(DEFAULT_PROFILE.bowlMl, undefined);
  assert.equal(crockeryNote({ plateCm: DEFAULT_PROFILE.plateCm, bowlMl: DEFAULT_PROFILE.bowlMl }), '');
});

test('the assumed plate that shipped by mistake is cleared', () => {
  const carrying = { profile: { name: 'Mia', plateCm: 27, bowlMl: 400 } };
  const after = clearAssumedCrockery(carrying, 2) as { profile: Record<string, unknown> };

  assert.equal(after.profile.plateCm, undefined);
  assert.equal(after.profile.bowlMl, undefined);
  assert.equal(after.profile.name, 'Mia', 'and nothing else is touched');
});

test('a size somebody measured themselves is left alone', () => {
  for (const profile of [
    { plateCm: 24, bowlMl: 400 },
    { plateCm: 27, bowlMl: 600 },
    { plateCm: 31, bowlMl: 250 },
  ]) {
    const after = clearAssumedCrockery({ profile }, 2) as { profile: Record<string, unknown> };
    assert.equal(after.profile.plateCm, profile.plateCm, `${profile.plateCm} cm was deliberate`);
  }
});

test('it does not run twice, or on a store that never had the default', () => {
  const carrying = { profile: { plateCm: 27, bowlMl: 400 } };
  assert.deepEqual(clearAssumedCrockery(carrying, 3), carrying, 'already migrated');
  assert.deepEqual(clearAssumedCrockery({ profile: {} }, 2), { profile: {} });
  assert.equal(clearAssumedCrockery(undefined, 2), undefined);
});

test('the migrations run in order, and both still work', () => {
  const oldFat = Math.round((2000 * 0.28) / 9);
  const before = {
    profile: { plateCm: 27, bowlMl: 400 },
    targets: { calories: 2000, protein: 120, fat: oldFat, carbs: 241 },
  };
  const after = migrate(before, 1) as { profile: Record<string, unknown>; targets: Targets };

  assert.equal(after.targets.fat, 67, 'the fat target was still raised');
  assert.equal(after.profile.plateCm, undefined, 'and the assumed plate cleared');
});
