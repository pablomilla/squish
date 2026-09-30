import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstLink, readShare, shareFromLink } from '../src/lib/shareIn';

/** Shared from another app: a recipe link, however it is wrapped, or words to describe. */

test('the link is found wherever the app put it, without its trailing punctuation', () => {
  assert.equal(firstLink('Check out this recipe! https://www.bbcgoodfood.com/recipes/turkey-bolognese via @Chef'), 'https://www.bbcgoodfood.com/recipes/turkey-bolognese');
  assert.equal(firstLink('(https://example.com/pasta).'), 'https://example.com/pasta');
  assert.equal(firstLink('https://vm.tiktok.com/ZMabc123/'), 'https://vm.tiktok.com/ZMabc123/');
  assert.equal(firstLink('no link here'), null);
  assert.equal(firstLink('javascript:alert(1)'), null);
});

test('a share with a link is a recipe; one with only words is a description', () => {
  assert.deepEqual(readShare({ title: 'Turkey Bolognese', text: 'Made this tonight https://example.com/bolognese' }), { kind: 'recipe', url: 'https://example.com/bolognese' });
  assert.deepEqual(readShare({ url: 'https://example.com/a', text: 'https://example.com/b' }), { kind: 'recipe', url: 'https://example.com/a' }, 'the link itself first');
  assert.deepEqual(readShare({ text: '2 eggs on toast and a coffee' }), { kind: 'words', text: '2 eggs on toast and a coffee' });
  assert.equal(readShare({ text: '   ' }), null);
});

test('every way in reads the same: the app link, the web app, and nothing else', () => {
  const link = 'https://example.com/recipes/curry';
  assert.deepEqual(shareFromLink(`squish://share?text=${encodeURIComponent(`Try this ${link}`)}`), { kind: 'recipe', url: link });
  assert.deepEqual(shareFromLink(`https://app.squish.online/?share&title=Curry&url=${encodeURIComponent(link)}`), { kind: 'recipe', url: link });
  assert.deepEqual(shareFromLink('squish://share?text=Beans%20on%20toast'), { kind: 'words', text: 'Beans on toast' });
  assert.equal(shareFromLink('squish://snap'), null);
  assert.equal(shareFromLink('https://app.squish.online/?url=https://example.com'), null, 'not a share without saying so');
});
