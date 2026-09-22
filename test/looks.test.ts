import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ALL_LOOKS, DEFAULT_LOOK, LOOKS, PLUS_LOOKS, isUnlocked, lookById, lookVars } from '../src/lib/looks';
import { ACHIEVEMENTS } from '../src/store/useSquish';

/**
 * The colourways.
 *
 * Two things here can break without anything failing: a look that asks for an
 * achievement nobody can earn, and the default colours drifting apart from the
 * stylesheet that also holds them. Neither throws, neither looks wrong in a
 * test that only reads this file, and both are only visible to somebody who
 * spent thirty days earning nothing.
 */

test('every look is earned against an achievement that exists', () => {
  const real = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const look of ALL_LOOKS) {
    if (look.unlock.kind !== 'achievement') continue;
    assert.ok(real.has(look.unlock.id), `"${look.name}" needs "${look.unlock.id}", which nothing awards`);
  }
});

test('one look needs nothing, and it is the one everybody starts in', () => {
  const free = ALL_LOOKS.filter((look) => look.unlock.kind === 'always');
  assert.equal(free.length, 1, 'exactly one, or a new install has a choice to make before it has done anything');
  assert.equal(free[0].id, DEFAULT_LOOK);
  assert.ok(isUnlocked(free[0], {}, false));
});

test('a look is locked until the achievement is', () => {
  const earned = LOOKS.find((look) => look.unlock.kind === 'achievement' && look.unlock.id === 'streak-7')!;
  assert.equal(isUnlocked(earned, {}, false), false);
  assert.equal(isUnlocked(earned, { 'streak-3': '2026-09-01' }, false), false, 'a different achievement is not this one');
  assert.equal(isUnlocked(earned, { 'streak-7': '2026-09-08' }, false), true);
});

test('a Plus look needs the subscription and nothing else opens it', () => {
  for (const look of PLUS_LOOKS) {
    // Not every achievement in the app, not a thirty-day streak, nothing.
    const everything = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, '2026-09-01']));
    assert.equal(isUnlocked(look, everything, false), false, `${look.name} opened without a subscription`);
    assert.equal(isUnlocked(look, {}, true), true, `${look.name} did not open with one`);
  }
});

test('nothing is both earned and sold', () => {
  // The union makes this unwriteable; the test says why it is shaped that way.
  // A colourway you can earn *and* buy devalues the earning and insults the
  // buying, and it is the first shortcut anybody reaches for when a set looks
  // thin.
  const earned = new Set(LOOKS.map((l) => l.id));
  for (const look of PLUS_LOOKS) assert.ok(!earned.has(look.id), `${look.name} is in both sets`);
});

test('a Plus colourway is locked until something outside the browser says otherwise', () => {
  // The successor to "there is nothing to subscribe to yet". There is now, and
  // the rule that replaced it matters more: the flag passed in here comes from
  // the server (lib/plan.ts) and never from storage, because a paywall a
  // devtools console defeats funds nothing.
  for (const look of PLUS_LOOKS) {
    assert.equal(isUnlocked(look, {}, false), false, `${look.name} was free`);
    assert.equal(isUnlocked(look, {}, true), true, `${look.name} stayed locked for a subscriber`);
  }

  // And an achievement colourway is never handed over by subscribing.
  const earned = LOOKS.filter((l) => l.unlock.kind === 'achievement');
  for (const look of earned) {
    assert.equal(isUnlocked(look, {}, true), false, `${look.name} was sold rather than earned`);
  }
});

test('ids are unique, and an unknown one falls back rather than blanking the mascot', () => {
  assert.equal(new Set(ALL_LOOKS.map((l) => l.id)).size, ALL_LOOKS.length);
  assert.equal(lookById('a-look-from-a-later-version').id, DEFAULT_LOOK);
});

test('each look gives three colours in each theme, and the themes differ', () => {
  for (const look of ALL_LOOKS) {
    for (const dark of [false, true]) {
      const vars = lookVars(look, dark);
      assert.deepEqual(Object.keys(vars), ['--squish-skin-0', '--squish-skin-1', '--squish-skin-2']);
      for (const [name, value] of Object.entries(vars)) {
        assert.match(value, /^#[0-9a-f]{6}$/, `${look.name} ${name} is not a hex colour`);
      }
    }
    assert.notDeepEqual(look.light, look.dark, `${look.name} would not adapt to dark mode`);
  }
});

test('the stylesheet default matches the default look', () => {
  // squish.css holds the same three colours, because the stylesheet owns them
  // until a look overrides it. A comment there says to keep them in step;
  // this is what makes that true rather than hopeful.
  const css = readFileSync('src/components/squish.css', 'utf8');
  const block = (selector: string) => {
    const found = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css);
    return [0, 1, 2].map((i) => new RegExp(`--squish-skin-${i}:\\s*(#[0-9a-f]{6})`).exec(found?.[1] ?? '')?.[1]);
  };

  const squish = lookById(DEFAULT_LOOK);
  assert.deepEqual(block(':root'), squish.light, 'the light default has drifted');
  assert.deepEqual(block(":root\\[data-theme='dark'\\]"), squish.dark, 'the dark default has drifted');
});
