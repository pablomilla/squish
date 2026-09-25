import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { ACCESSORIES, SLOTS, canWear, dress, inSeason, lockedNote, onShow, shelves, toggle, wearable, type AccessoryArt } from '../src/lib/outfit';
import { MASCOT_ART } from '../src/components/squish-art';
import type { Mood } from '../src/types';

/** What Squish wears: the rules for who may wear what, and how it is layered. */

const MOODS = Object.keys(MASCOT_ART) as Mood[];
const day = (iso: string) => new Date(`${iso}T12:00:00`);
const nobody = { unlocked: {}, subscribed: false, today: day('2026-09-24') };
const item = (id: string) => ACCESSORIES.find((a) => a.id === id)!;

test('every item in the catalogue has artwork, and every artwork is in the catalogue', () => {
  const files = readdirSync('src/components/accessory-art').map((f) => f.replace(/\.ts$/, '')).sort();
  assert.deepEqual(ACCESSORIES.map((a) => a.id).sort(), files);
  assert.equal(new Set(ACCESSORIES.map((a) => a.id)).size, ACCESSORIES.length, 'an id is used twice');
});

test('every item is drawn for all seven poses, with its ids kept to itself', async () => {
  for (const { id } of ACCESSORIES) {
    const art = (await import(`../src/components/accessory-art/${id}.ts`)).default as AccessoryArt;
    for (const mood of MOODS) {
      assert.ok(art.front[mood], `${id} has nothing in front for ${mood}`);
      for (const layer of [art.back[mood], art.front[mood]]) {
        for (const [, name] of layer.matchAll(/\bid="([^"]+)"/g)) {
          assert.ok(name.startsWith(`__ID__${id}-`), `${id} ${mood}: id "${name}" could collide with another item`);
        }
        assert.doesNotMatch(layer, /<image|<text|<style|class=/, `${id} ${mood}: raster, text or CSS`);
      }
    }
  }
});

test('earned items follow the achievements the looks already use', () => {
  assert.equal(canWear(item('party-hat'), nobody), false);
  assert.equal(canWear(item('party-hat'), { ...nobody, unlocked: { 'first-meal': '2026-09-01' } }), true);
  assert.equal(canWear(item('knit-scarf'), { ...nobody, unlocked: { 'streak-3': '2026-09-01' } }), false);
  assert.equal(canWear(item('knit-scarf'), { ...nobody, unlocked: { 'streak-7': '2026-09-01' } }), true);
});

test('Plus items need Plus; packs are not on sale to anybody yet', () => {
  assert.equal(canWear(item('crown'), nobody), false);
  assert.equal(canWear(item('crown'), { ...nobody, subscribed: true }), true);
  assert.equal(canWear(item('chef-hat'), { ...nobody, subscribed: true }), false);
});

test('seasons, including New Year running over the turn of the year', () => {
  assert.ok(inSeason('winter', day('2026-12-01')) && inSeason('winter', day('2026-12-31')));
  assert.ok(!inSeason('winter', day('2027-01-01')));
  assert.ok(inSeason('new-year', day('2026-12-26')) && inSeason('new-year', day('2027-01-07')));
  assert.ok(!inSeason('new-year', day('2026-12-25')) && !inSeason('new-year', day('2027-01-08')));
  assert.ok(inSeason('halloween', day('2027-10-15')) && !inSeason('halloween', day('2027-11-01')));
});

test('a seasonal item is for Plus, in its season, and only listed then', () => {
  const santa = item('santa-hat');
  const december = { ...nobody, subscribed: true, today: day('2026-12-10') };
  assert.equal(canWear(santa, december), true);
  assert.equal(canWear(santa, { ...december, subscribed: false }), false);
  assert.equal(canWear(santa, { ...december, today: day('2027-01-10') }), false);
  assert.equal(onShow(santa, day('2026-09-24')), false);
  assert.equal(onShow(santa, day('2026-12-10')), true);
  assert.equal(onShow(item('crown'), day('2026-09-24')), true);
});

test('what is worn is what may be worn today; the choice itself is kept', () => {
  const outfit = { head: 'crown', face: 'round-specs', neck: 'knit-scarf' };
  const earned = { 'streak-3': 'x', 'streak-7': 'x' };
  assert.deepEqual(wearable(outfit, { ...nobody, unlocked: earned }), { face: 'round-specs', neck: 'knit-scarf' });
  assert.deepEqual(wearable(outfit, { ...nobody, unlocked: earned, subscribed: true }), outfit);
  // Nonsense from an old backup or a hand-edited store is ignored, not drawn.
  assert.deepEqual(wearable({ head: 'round-specs', face: 'nope' }, { ...nobody, unlocked: earned }), {});
  assert.deepEqual(wearable(undefined, nobody), {});
});

test('one item per slot: putting one on swaps, pressing it again takes it off', () => {
  let outfit = toggle({}, item('party-hat'));
  assert.deepEqual(outfit, { head: 'party-hat' });
  outfit = toggle(outfit, item('round-specs'));
  outfit = toggle(outfit, item('crown'));
  assert.deepEqual(outfit, { head: 'crown', face: 'round-specs' });
  assert.deepEqual(toggle(outfit, item('crown')), { face: 'round-specs' });
});

test('layers go in the right places, drawn back in the space they were measured in', () => {
  const art = (tag: string): AccessoryArt => ({
    back: Object.fromEntries(MOODS.map((m) => [m, `<i-${tag}-back/>`])) as Record<Mood, string>,
    front: Object.fromEntries(MOODS.map((m) => [m, `<i-${tag}-front/>`])) as Record<Mood, string>,
  });
  for (const mood of MOODS) {
    const pose = MASCOT_ART[mood];
    const out = dress(pose, mood, { head: art('head'), face: art('face'), neck: art('neck') });
    const at = (needle: string) => {
      const i = out.indexOf(needle);
      assert.ok(i >= 0, `${mood}: ${needle} missing`);
      return i;
    };
    // Shadow, backs, body, face, face item, neck item, props, head item, arms.
    const order = ['__ID__shadow"', '<i-head-back/>', '__ID__body"', '__ID__face"', '<i-face-front/>', '<i-neck-front/>', '__ID__props"', '<i-head-front/>', '__ID__arms"'];
    const positions = order.map(at);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${mood}: layers out of order`);

    const [, x, y, s] = pose.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/)!;
    assert.ok(out.includes(`scale(${+(1 / Number(s)).toFixed(6)}) translate(${-Number(x)} ${-Number(y)})`), `${mood}: not undone`);
  }
  assert.equal(dress(MASCOT_ART.calm, 'calm', {}), MASCOT_ART.calm, 'nothing worn changes nothing');
  assert.equal(SLOTS.length, 3);
});

test('pickers group by how things are got: yours, earn, Plus, then each pack', () => {
  const listed = ACCESSORIES.filter((a) => onShow(a, nobody.today));
  const groups = shelves(listed, { ...nobody, unlocked: { 'first-meal': 'x' } });
  assert.deepEqual(groups.map((g) => g.title), ['Yours', 'Earn these', 'With Squish Plus', 'Packs']);
  assert.deepEqual(groups[0].items.map((a) => a.id), ['party-hat']);
  assert.deepEqual(groups[3].items.map((a) => a.id), ['chef-hat', 'neckerchief', 'sweatband', 'medal', 'beanie', 'earmuffs'], 'each pack together');
  assert.equal(lockedNote(item('medal').unlock), 'Sporty pack');
  // Everything listed lands on exactly one shelf.
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), listed.length);

  // With Plus, the Plus shelf empties into Yours and disappears; empty shelves are never shown.
  const plus = shelves(listed, { ...nobody, subscribed: true });
  assert.deepEqual(plus.map((g) => g.title), ['Yours', 'Earn these', 'Packs']);

  assert.equal(lockedNote(item('santa-hat').unlock), 'Winter only');
  assert.equal(lockedNote(item('crown').unlock), '', 'the heading already says Plus');
});

test('a pack is offered as one thing, saying what is in it', async () => {
  const { ALL_PACKS, listWords, packLocked, packsAmong } = await import('../src/lib/packs');
  const [chef, sporty, cosy] = ALL_PACKS;
  assert.deepEqual(chef.look, { head: 'chef-hat', neck: 'neckerchief' });
  assert.equal(chef.words, 'Chef’s hat and neckerchief');
  assert.equal(sporty.words, 'Sweatband and medal');
  // Two head items can't both be worn, so the picture wears the first; the words list them all.
  assert.deepEqual(cosy.look, { head: 'beanie' });
  assert.equal(cosy.words, 'Bobble beanie, earmuffs and the Rainy window scene');
  assert.equal(cosy.count, 3);
  assert.match(packLocked(chef), /^The Chef pack — chef’s hat and neckerchief — is not on sale yet\.$/);
  assert.equal(listWords(['a', 'b', 'c']), 'a, b and c');

  // The scene picker shows only packs with a scene in them.
  const { SCENES } = await import('../src/lib/scenes');
  assert.deepEqual(packsAmong(SCENES).map((p) => p.pack), ['cosy']);
  assert.deepEqual(packsAmong(ACCESSORIES).map((p) => p.pack), ['chef', 'sporty', 'cosy']);
});
