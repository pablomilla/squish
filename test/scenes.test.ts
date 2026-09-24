import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SCENES, canUseScene, sceneInUse, sceneOnShow } from '../src/lib/scenes';
import { ACHIEVEMENTS } from '../src/store/useSquish';

/** Home scenes: a place behind Squish, come by like accessories. */

const day = (iso: string) => new Date(`${iso}T12:00:00`);
const nobody = { unlocked: {}, subscribed: false, today: day('2026-09-24') };
const scene = (id: string) => SCENES.find((s) => s.id === id)!;

test('every scene in the catalogue has a light and a dark picture, and nothing else is shipped', () => {
  const files = readdirSync('src/assets/scenes').sort();
  assert.deepEqual(files, SCENES.flatMap((s) => [`${s.id}-dark.svg`, `${s.id}-light.svg`]).sort());
  for (const file of files) {
    const svg = readFileSync(`src/assets/scenes/${file}`, 'utf8');
    assert.match(svg, /viewBox="0 0 1344 690"/, `${file}: not the card's artboard`);
    assert.doesNotMatch(svg, /<image|<text|<style|<script|class=/, `${file}: raster, text, CSS or script`);
  }
});

test('earned scenes follow achievements that exist', () => {
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const s of SCENES) if (s.unlock.kind === 'achievement') assert.ok(ids.has(s.unlock.id), `${s.id}: no ${s.unlock.id} achievement`);
  assert.equal(canUseScene(scene('kitchen'), nobody), false);
  assert.equal(canUseScene(scene('kitchen'), { ...nobody, unlocked: { 'streak-14': 'x' } }), true);
  assert.equal(canUseScene(scene('picnic'), { ...nobody, unlocked: { 'streak-14': 'x' } }), false);
});

test('Plus scenes need Plus, the Cosy pack is not on sale, seasons come and go', () => {
  assert.equal(canUseScene(scene('stars'), nobody), false);
  assert.equal(canUseScene(scene('stars'), { ...nobody, subscribed: true }), true);
  assert.equal(canUseScene(scene('rainy-window'), { ...nobody, subscribed: true }), false);
  const village = scene('snowy-village');
  assert.equal(sceneOnShow(village, day('2026-09-24')), false);
  assert.equal(sceneOnShow(village, day('2026-12-24')), true);
  assert.equal(canUseScene(village, { ...nobody, subscribed: true, today: day('2026-12-24') }), true);
});

test('a scene they may no longer have falls back to the plain card', () => {
  assert.equal(sceneInUse('stars', { ...nobody, subscribed: true })?.id, 'stars');
  assert.equal(sceneInUse('stars', nobody), undefined);
  assert.equal(sceneInUse('', nobody), undefined);
  assert.equal(sceneInUse('not-a-scene', { ...nobody, subscribed: true }), undefined);
});
