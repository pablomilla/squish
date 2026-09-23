import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * Screens that load when opened.
 *
 * Proved in a browser rather than here — there is no DOM under node --test —
 * by serving a 404 for a screen's file, the way a deploy does to somebody who
 * had the app open: with the recovery the page reloads once and the screen
 * appears, without it the screen is blank. What these check is that the
 * pieces that made that true stay in place.
 */
const lazy = readFileSync('src/lib/lazyScreen.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

test('a missing screen file reloads the page, once', () => {
  assert.match(lazy, /window\.location\.reload\(\)/, 'nothing recovers from a deploy');
  assert.match(lazy, /sessionStorage\.getItem\(RELOADED\) === '1'/, 'nothing stops it reloading for ever');
});

test('the first screen anybody sees is not made to wait for a second download', () => {
  assert.match(app, /^import Home from '\.\/screens\/Home';/m);
  assert.match(app, /^import Waking from '\.\/screens\/Waking';/m);
});

test('the screens few people open are not in the first download', () => {
  for (const name of ['Admin', 'Ask', 'Onboarding', 'ResetPassword', 'Paywall']) {
    assert.match(app, new RegExp(`const ${name} = lazyScreen\\(`), `${name} is back in the main file`);
    assert.ok(!new RegExp(`^import ${name} from`, 'm').test(app), `${name} is imported eagerly`);
  }
});
