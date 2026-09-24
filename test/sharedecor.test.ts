import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FRAMES, STICKERS, canUse, decorOnShow, isBadge, toggleSticker, usableDecor } from '../src/lib/shareDecor';
import { ACHIEVEMENTS } from '../src/store/useSquish';

/** Frames and stickers for the share card: what exists, who may use it, how many. */

const day = (iso: string) => new Date(`${iso}T12:00:00`);
const nobody = { unlocked: {}, subscribed: false, today: day('2026-09-24') };
const find = (list: typeof FRAMES, id: string) => list.find((d) => d.id === id)!;
const files = (kind: string) => readdirSync(`src/assets/share/${kind}`).map((f) => f.replace(/\.svg$/, '')).sort();

test('every frame, sticker and badge in the catalogue has artwork, and nothing extra is shipped', () => {
  assert.deepEqual(FRAMES.map((f) => f.id).sort(), files('frames'));
  assert.deepEqual(STICKERS.filter((s) => !isBadge(s.id)).map((s) => s.id).sort(), files('stickers'));
  assert.deepEqual(STICKERS.filter((s) => isBadge(s.id)).map((s) => s.id).sort(), files('badges'));
  for (const kind of ['frames', 'stickers', 'badges']) {
    for (const id of files(kind)) {
      const svg = readFileSync(`src/assets/share/${kind}/${id}.svg`, 'utf8');
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${kind}/${id}: not a standalone SVG a canvas can draw`);
      assert.doesNotMatch(svg, /<image|<text|<style|<script|class=/, `${kind}/${id}: raster, text, CSS or script`);
    }
  }
});

test('everything earned is earned against an achievement that exists', () => {
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const d of [...FRAMES, ...STICKERS]) if (d.unlock.kind === 'achievement') assert.ok(ids.has(d.unlock.id), `${d.id}: no ${d.unlock.id}`);
});

test('the four brief rules: earned, Plus, seasonal stickers free, seasonal frames with Plus', () => {
  assert.equal(canUse(find(FRAMES, 'scallop'), nobody), false);
  assert.equal(canUse(find(FRAMES, 'scallop'), { ...nobody, unlocked: { 'first-share': 'x' } }), true);
  assert.equal(canUse(find(FRAMES, 'gold-foil'), { ...nobody, subscribed: true }), true);
  assert.equal(canUse(find(STICKERS, 'rainbow'), nobody), false);
  assert.equal(canUse(find(STICKERS, 'streak-100'), { ...nobody, unlocked: { 'streak-100': 'x' } }), true);

  const december = { ...nobody, today: day('2026-12-12') };
  assert.equal(canUse(find(STICKERS, 'gingerbread'), december), true, 'seasonal stickers are for everybody');
  assert.equal(canUse(find(STICKERS, 'gingerbread'), nobody), false, 'but only in season');
  assert.equal(canUse(find(FRAMES, 'snowflake'), december), false, 'the seasonal frame needs Plus');
  assert.equal(canUse(find(FRAMES, 'snowflake'), { ...december, subscribed: true }), true);
  assert.equal(decorOnShow(find(STICKERS, 'pumpkin'), day('2026-09-24')), false);
  assert.equal(decorOnShow(find(STICKERS, 'pumpkin'), day('2026-10-20')), true);
});

test('two stickers at most; a third replaces the older one; tapping one again removes it', () => {
  let stickers = toggleSticker([], 'heart');
  stickers = toggleSticker(stickers, 'star');
  assert.deepEqual(stickers, ['heart', 'star']);
  assert.deepEqual(toggleSticker(stickers, 'carrot'), ['star', 'carrot']);
  assert.deepEqual(toggleSticker(stickers, 'heart'), ['star']);
});

test('only what may be used today reaches the card', () => {
  const earned = { ...nobody, unlocked: { 'first-meal': 'x', 'streak-3': 'x' } };
  assert.deepEqual(usableDecor({ frame: 'gold-foil', stickers: ['rainbow', 'heart'] }, earned), { frame: '', stickers: ['heart'] });
  assert.deepEqual(usableDecor({ frame: 'nope', stickers: ['heart', 'heart', 'carrot', 'avocado'] }, earned), { frame: '', stickers: ['heart', 'carrot'] });
  assert.deepEqual(usableDecor(undefined, earned), { frame: '', stickers: [] });
  // A mangled backup is ignored rather than thrown on.
  assert.deepEqual(usableDecor({ frame: 'scallop', stickers: 'heart' as unknown as string[] }, earned), { frame: '', stickers: [] });
});
