import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_DIR, withVersions } from '../server/site';

/**
 * Browsers keep the website's CSS and scripts for an hour, so a page that
 * changes with its stylesheet must point at the new stylesheet, not the one
 * the browser already has: each link carries a fingerprint of the file.
 */
test('the website’s stylesheet and scripts carry a fingerprint of what is in them', () => {
  const name = 'versions-test.css';
  const file = join(SITE_DIR, name);
  try {
    writeFileSync(file, 'a { color: red; }');
    const first = withVersions(`<link rel="stylesheet" href="/${name}" /><script src="/${name}" defer></script>`);
    assert.match(first, new RegExp(`href="/${name}\\?v=[0-9a-f]{8}"`));
    assert.match(first, new RegExp(`src="/${name}\\?v=[0-9a-f]{8}"`));
    writeFileSync(file, 'a { color: blue; }');
    const second = withVersions(`<link rel="stylesheet" href="/${name}" />`);
    assert.notEqual(second.match(/\?v=(\w+)/)?.[1], first.match(/\?v=(\w+)/)?.[1], 'a changed file gets a new fingerprint');
  } finally {
    rmSync(file, { force: true });
  }
  const other = '<a href="/help">Help</a><img src="/img/wordmark.svg" /><script src="/missing.js"></script><script src="https://x.example/a.js"></script>';
  assert.equal(withVersions(other), other, 'pages, images, missing files and other sites are left alone');
});

test('the real pages’ stylesheet and scripts are fingerprinted', () => {
  const html = withVersions('<link rel="stylesheet" href="/site.css" /><script src="/menu.js" defer></script><script src="/help.js" defer></script>');
  assert.match(html, /href="\/site\.css\?v=[0-9a-f]{8}"/);
  assert.match(html, /src="\/menu\.js\?v=[0-9a-f]{8}"/);
  assert.match(html, /src="\/help\.js\?v=[0-9a-f]{8}"/);
});
