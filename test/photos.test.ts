import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOversized, rehomePhotos } from '../src/lib/rehome';

/**
 * Moving photographs out of the diary.
 *
 * The measurements behind this: one meal photo was 300 KB, a browser's
 * localStorage holds about 5.1 MB, and so seventeen photographed meals filled
 * it and the eighteenth could not be written at all. A week of breakfasts.
 *
 * IndexedDB itself is not exercised here — there is none under `node --test`.
 * That is why the shrinking and the saving are passed in rather than imported:
 * what is worth testing is the part with a decision in it, which photographs
 * count as oversized and what happens to one that will not convert, and none
 * of that needs a browser.
 */

test('a thumbnail is left alone and a photograph is not', () => {
  const thumb = 'data:image/jpeg;base64,' + 'A'.repeat(6_000);      // measured: ~6 KB
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(300_000);    // measured: ~300 KB
  assert.equal(isOversized(thumb), false);
  assert.equal(isOversized(photo), true);
  assert.equal(isOversized(undefined), false);
});

test('rehoming hands back a thumbnail for each photograph, and touches nothing else', async () => {
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(300_000);
  const meals = [
    { id: 'a', photo },
    { id: 'b', photo: 'data:image/jpeg;base64,' + 'A'.repeat(6_000) },
    { id: 'c' },
    { id: 'd', photo },
  ];

  const moved = await rehomePhotos(meals, async () => 'thumb', async () => {});
  assert.deepEqual(moved, { a: 'thumb', d: 'thumb' }, 'only the oversized ones should move');
});

test('a photograph that will not convert is kept, not dropped', async () => {
  // Better a diary that is still too big than a diary missing somebody's
  // lunch. Shrinking can fail — a corrupt image, a canvas the browser will
  // not give us — and that is not a reason to throw the picture away.
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(300_000);
  const moved = await rehomePhotos(
    [{ id: 'a', photo }, { id: 'b', photo }],
    async (url) => {
      if (url.length > 10) throw new Error('canvas unavailable');
      return 'thumb';
    },
    async () => {},
  );
  assert.deepEqual(moved, {}, 'a failed conversion must not report the photo as moved');
});

test('rehoming an empty diary does nothing and does not throw', async () => {
  assert.deepEqual(await rehomePhotos([], async () => 'thumb', async () => {}), {});
});
