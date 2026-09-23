import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The loading screens. The animation itself was checked in a browser; these
 * keep the pieces it depends on from quietly going missing.
 */
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/screens/waking.css', 'utf8');

test('Squish is on screen before any JavaScript arrives', () => {
  assert.match(html, /<div id="root">\s*<div class="splash"/, 'the splash is not inside #root, so React will not replace it');
  assert.match(html, /src="\/squish-hello\.svg"/);
  assert.ok(existsSync('public/squish-hello.svg'), 'the splash mascot file is missing — npm run build:site-art');
});

test('the splash and the waking screen are the same size, so the handover does not jump', () => {
  assert.match(html, /\.splash-hop \{ width: 176px; height: 176px;/);
  assert.match(readFileSync('src/screens/Waking.tsx', 'utf8'), /size=\{176\}/);
  assert.match(css, /\.waking-stage \{ position: relative; width: 176px; height: 176px; \}/);
});

test('none of it moves for somebody who has asked for less motion', () => {
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(readFileSync('public/squish-hello.svg', 'utf8'), /prefers-reduced-motion:reduce/);
});
