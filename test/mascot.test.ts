import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MASCOT_ART, MASCOT_VIEWBOX, WORDMARK_ART } from '../src/components/squish-art.ts';
import type { Mood } from '../src/types.ts';

const MOODS: Mood[] = ['excited', 'nomnom', 'calm', 'sleepy', 'proud', 'cheering', 'thinking'];

test('every mood the app can ask for has artwork', () => {
  for (const mood of MOODS) assert.ok(MASCOT_ART[mood]?.length > 1000, `${mood} is missing or empty`);
  assert.equal(Object.keys(MASCOT_ART).length, MOODS.length);
});

test('the artwork is vector, not a picture of vector', () => {
  for (const mood of MOODS) {
    assert.ok(!MASCOT_ART[mood].includes('<image'), `${mood} embeds a raster image`);
    assert.ok(!MASCOT_ART[mood].includes('base64'), `${mood} embeds encoded data`);
  }
});

test('every id carries the instance placeholder, so two mascots cannot collide', () => {
  for (const mood of MOODS) {
    const ids = [...MASCOT_ART[mood].matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const references = [...MASCOT_ART[mood].matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(ids.length > 0, `${mood} has no ids at all`);
    for (const id of [...ids, ...references]) assert.ok(id.startsWith('__ID__'), `${mood}: "${id}" was left unprefixed`);
  }
});

test('every gradient a pose points at is defined in that same pose', () => {
  for (const mood of MOODS) {
    const defined = new Set([...MASCOT_ART[mood].matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, used] of MASCOT_ART[mood].matchAll(/url\(#([^)]+)\)/g)) {
      assert.ok(defined.has(used), `${mood} points at #${used}, which nothing defines`);
    }
  }
});

test('skin tones are themeable, so dark mode is not a second set of files', () => {
  for (const mood of MOODS) {
    // A bare light-skin hex would be stuck light; inside a var() fallback is fine.
    assert.ok(!/(?<!, )#FDEADC/i.test(MASCOT_ART[mood]), `${mood} has a skin tone that cannot be themed`);
    assert.ok(MASCOT_ART[mood].includes('var(--squish-skin-1'), `${mood} never uses the skin property`);
  }
});

test('the face is animatable: eyes wrapped for the blink, mood labelled', () => {
  for (const mood of MOODS) {
    assert.ok(MASCOT_ART[mood].includes('class="sq-blink"'), `${mood} has nothing to blink`);
    assert.ok(MASCOT_ART[mood].includes(`data-mood="${mood}"`), `${mood} is not labelled with its mood`);
  }
});

test('all seven poses share one viewBox, so sizes are interchangeable', () => {
  assert.equal(MASCOT_VIEWBOX, '0 0 512 512');
});

test('the logotype is drawn artwork, themeable and instance-safe', () => {
  assert.ok(WORDMARK_ART.length > 1000);
  assert.ok(!WORDMARK_ART.includes('<text'), 'the lettering must be outlined, not live type');
  assert.ok(WORDMARK_ART.includes('var(--squish-word-0'), 'the ink must be themeable or it vanishes in dark mode');
  for (const [, id] of WORDMARK_ART.matchAll(/\bid="([^"]+)"/g)) assert.ok(id.startsWith('__ID__'), `"${id}" unprefixed`);
  const defined = new Set([...WORDMARK_ART.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const [, used] of WORDMARK_ART.matchAll(/url\(#([^)]+)\)/g)) assert.ok(defined.has(used), `#${used} is undefined`);
});
