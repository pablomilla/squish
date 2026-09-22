import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_LOOK, LOOKS, isUnlocked, lookById, lookVars } from '../src/lib/looks';
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
  for (const look of LOOKS) {
    if (!look.needs) continue;
    assert.ok(real.has(look.needs), `"${look.name}" needs "${look.needs}", which nothing awards`);
  }
});

test('one look needs nothing, and it is the one everybody starts in', () => {
  const free = LOOKS.filter((look) => !look.needs);
  assert.equal(free.length, 1, 'exactly one, or a new install has a choice to make before it has done anything');
  assert.equal(free[0].id, DEFAULT_LOOK);
  assert.ok(isUnlocked(free[0], {}));
});

test('a look is locked until the achievement is', () => {
  const earned = LOOKS.find((look) => look.needs === 'streak-7')!;
  assert.equal(isUnlocked(earned, {}), false);
  assert.equal(isUnlocked(earned, { 'streak-3': '2026-09-01' }), false, 'a different achievement is not this one');
  assert.equal(isUnlocked(earned, { 'streak-7': '2026-09-08' }), true);
});

test('ids are unique, and an unknown one falls back rather than blanking the mascot', () => {
  assert.equal(new Set(LOOKS.map((l) => l.id)).size, LOOKS.length);
  assert.equal(lookById('a-look-from-a-later-version').id, DEFAULT_LOOK);
});

test('each look gives three colours in each theme, and the themes differ', () => {
  for (const look of LOOKS) {
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
