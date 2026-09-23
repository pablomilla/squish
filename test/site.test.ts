import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { isSiteRequest, pageFor, SITE_DIR } from '../server/site';

/**
 * Which address gets the website and which gets the app. Getting this wrong
 * in one direction hides the app from everybody; in the other, it serves the
 * app where the website should be, which is merely what happens today.
 */
afterEach(() => {
  delete process.env.SQUISH_SITE_ORIGIN;
});

test('with no website configured, every address is the app', () => {
  assert.equal(isSiteRequest('squish.online'), false);
  assert.equal(isSiteRequest('app.squish.online'), false);
});

test('the website address, with or without www, is the website; the app address is not', () => {
  process.env.SQUISH_SITE_ORIGIN = 'https://squish.online';
  assert.equal(isSiteRequest('squish.online'), true);
  assert.equal(isSiteRequest('www.squish.online'), true);
  assert.equal(isSiteRequest('SQUISH.online'), true);
  assert.equal(isSiteRequest('app.squish.online'), false);
  assert.equal(isSiteRequest('squish.online.evil.example'), false);
  assert.equal(isSiteRequest(undefined), false);
});

test('a port in the configured address does not stop it matching', () => {
  // Express's req.hostname never carries the port.
  process.env.SQUISH_SITE_ORIGIN = 'http://localhost:4173';
  assert.equal(isSiteRequest('localhost'), true);
});

test('pages come from site/ and nowhere else', () => {
  assert.equal(pageFor('/'), `${SITE_DIR}/index.html`);
  assert.equal(pageFor('/support'), `${SITE_DIR}/support.html`);
  assert.equal(pageFor('/support/'), `${SITE_DIR}/support.html`);
  assert.equal(pageFor('/nope'), null);
  assert.equal(pageFor('/../package'), null);
  assert.equal(pageFor('/%2e%2e/package'), null);
  assert.equal(pageFor('/..%2fserver%2findex'), null);
  assert.equal(pageFor('/site.css'), null, 'files with extensions are served as files, not pages');
  assert.equal(pageFor('/%E0%A4%A'), null, 'a malformed address is a 404, not a crash');
});
