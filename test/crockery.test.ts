import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SYSTEM, crockeryNote } from '../server/claude';

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
