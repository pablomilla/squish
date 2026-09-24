import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOOKS, PLUS_LOOKS, finishGradient } from '../src/lib/looks';
import { MASCOT_ART } from '../src/components/squish-art';

/** Squish Plus colourways are finishes — rainbow, metal, stripes — not just more colours. */

test('every Plus look has a finish, and no earned look does', () => {
  assert.equal(PLUS_LOOKS.length, 6);
  assert.ok(PLUS_LOOKS.every((look) => look.finish && look.finish.stops.length >= 2));
  assert.ok(LOOKS.every((look) => !look.finish), 'an earned look has a Plus finish');
});

test('a finish is a gradient of its colours, moving unless asked to be still', () => {
  const gold = PLUS_LOOKS.find((l) => l.id === 'gold')!.finish!;
  const moving = finishGradient('x-skin', gold, false);
  assert.match(moving, /^<linearGradient id="x-skin"/);
  assert.equal((moving.match(/<stop /g) ?? []).length, gold.stops.length);
  assert.match(moving, /animateTransform/);
  assert.doesNotMatch(finishGradient('x-skin', gold, true), /animateTransform/, 'moves for somebody who asked for less motion');
});

test('stripes repeat; blends reflect', () => {
  const candy = PLUS_LOOKS.find((l) => l.id === 'candy')!.finish!;
  assert.match(finishGradient('x', candy, true), /spreadMethod="repeat"/);
  const rainbow = PLUS_LOOKS.find((l) => l.id === 'rainbow')!.finish!;
  assert.match(finishGradient('x', rainbow, true), /spreadMethod="reflect"/);
});

test('every pose has the two gradients a finish replaces', () => {
  for (const [mood, art] of Object.entries(MASCOT_ART)) {
    assert.match(art, /<linearGradient id="__ID__skin"[\s\S]*?<\/linearGradient>/, `${mood} has no body gradient`);
    assert.match(art, /<linearGradient id="__ID__arm"[\s\S]*?<\/linearGradient>/, `${mood} has no arm gradient`);
  }
});
