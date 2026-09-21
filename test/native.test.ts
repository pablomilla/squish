import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiUrl, isNative } from '../src/lib/origin';

/**
 * Where the server is, once the app stops being a web page.
 *
 * In a browser `/api/chat` has always meant the right thing because the page
 * came from the server. Inside the phone app it means nothing: the page is a
 * file, served from `capacitor://localhost`, with no server behind it. This
 * is the seam, and a call that slips past it fails on a device with a 404
 * from a web view — which reads like the server is down.
 */

const withCapacitor = <T>(native: boolean, body: () => T): T => {
  (globalThis as Record<string, unknown>).Capacitor = { isNativePlatform: () => native };
  try {
    return body();
  } finally {
    delete (globalThis as Record<string, unknown>).Capacitor;
  }
};

test('a browser is left exactly as it was', () => {
  assert.equal(isNative(), false);
  for (const path of ['/api/chat', '/api/health', '/api/barcode/5012345678900']) {
    assert.equal(apiUrl(path), path, 'same origin, same path, no change at all');
  }
});

test('something pretending to be Capacitor is not enough', () => {
  (globalThis as Record<string, unknown>).Capacitor = {};
  try {
    assert.equal(isNative(), false, 'the check is the function, not the object');
  } finally {
    delete (globalThis as Record<string, unknown>).Capacitor;
  }
});

test('inside the app, a build with no server named says so loudly', () => {
  // The alternative is an app that looks broken for reasons nobody can see.
  // This is a build mistake and it should fail like one.
  withCapacitor(true, () => {
    assert.throws(() => apiUrl('/api/chat'), /VITE_API_ORIGIN/);
  });
});

test('nothing in the app fetches a bare path any more', async () => {
  // The seam only works if everything goes through it. A new `fetch('/api/…')`
  // would pass every other test in this suite and fail only on a phone.
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const offenders: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.tsx?$/.test(entry.name)) {
        const source = await readFile(path, 'utf8');
        for (const [line] of source.matchAll(/fetch\(\s*['"`]\/[^'"`]*/g)) offenders.push(`${path}: ${line}`);
      }
    }
  };
  await walk('src');

  assert.deepEqual(offenders, [], 'these must go through apiUrl() or they will 404 on a phone');
});
