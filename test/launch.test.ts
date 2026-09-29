import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSnapLink } from '../src/lib/launch';

/** Every way in to a quick snap is one link, however it is spelled. */
test('a snap link is known in every form the widgets, shortcuts and web app use', () => {
  for (const url of ['squish://snap', 'squish://snap/', 'app.squish.tracker://snap', 'https://app.squish.online/?snap', 'https://app.squish.online/?snap=1', 'https://app.squish.online/snap', 'https://app.squish.online/#snap']) {
    assert.equal(isSnapLink(url), true, url);
  }
  for (const url of ['squish://home', 'https://app.squish.online/', 'https://app.squish.online/?snapshot=1', 'https://evil.example/snapper', 'not a url']) {
    assert.equal(isSnapLink(url), false, url);
  }
});
