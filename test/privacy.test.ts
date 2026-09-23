import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { render } from '../server/privacy';

/**
 * The privacy page.
 *
 * The policy is the one page on the site with a legal job to do, so the tests
 * here are less about markdown than about the two ways a rendered policy can
 * be actively harmful: leaking the notes written to whoever maintains it, and
 * quietly dropping a section so the published policy says less than the one
 * that was reviewed.
 */

test('notes to the maintainer never reach the page', () => {
  // The policy carries an HTML comment telling whoever publishes it to fill in
  // a contact address. Shipping that to the public page would be worse than
  // shipping no policy, because it would look finished.
  const html = render('<!-- TODO: put a real address here -->\n\nHello.');
  assert.ok(!html.includes('TODO'), 'a maintainer note was rendered onto the page');
  assert.ok(!html.includes('<!--'), 'an HTML comment survived into the output');
  assert.match(html, /<p>Hello\.<\/p>/);
});

test('the real policy renders, with every section it has', () => {
  const source = readFileSync('docs/privacy.md', 'utf8');
  const html = render(source);

  const headings = [...source.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  assert.ok(headings.length >= 8, `only found ${headings.length} sections to check`);
  for (const heading of headings) {
    const escaped = heading.replace(/&/g, '&amp;');
    assert.ok(html.includes(`<h2>${escaped}</h2>`), `the section "${heading}" did not survive rendering`);
  }

  assert.ok(!html.includes('TODO'), 'the real policy leaked a maintainer note');
  assert.ok(html.includes('<table>'), 'the tables did not render');
});

test('tables keep their shape, and the divider is not a row', () => {
  const html = render('| Right | How |\n|---|---|\n| See it | Export JSON |\n| Delete it | Reset |');
  assert.match(html, /<thead><tr><th>Right<\/th><th>How<\/th><\/tr><\/thead>/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 3, 'the |---| divider was rendered as a row');
  assert.ok(!html.includes('---'), 'the divider leaked into a cell');
});

test('a hard-wrapped bullet stays one bullet', () => {
  // The policy is wrapped at 80 characters and most of its bullets run on. A
  // renderer that started a new paragraph at each wrap would shred it.
  const html = render('- Your diary lives on your device. A copy is kept on our\n  server so you can get it back.\n- Photos are part of that copy.');
  assert.equal((html.match(/<li>/g) ?? []).length, 2);
  assert.match(html, /<li>Your diary lives on your device\. A copy is kept on our server so you can get it back\.<\/li>/);
});

test('markdown cannot smuggle HTML onto the page', () => {
  const html = render('Hello <script>alert(1)</script> and <img src=x onerror=y>.');
  assert.ok(!html.includes('<script>'), 'a script tag was rendered');
  assert.ok(!html.includes('<img'), 'an img tag was rendered');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('only http and mailto become links', () => {
  // The contact address has to be tappable — a policy whose contact route is
  // a string you retype is not much of a contact route. Everything else, and
  // javascript: above all, stays as characters.
  const html = render('[web](https://ico.org.uk), [mail](mailto:privacy@squish.online), [no](javascript:alert(1))');
  assert.match(html, /<a href="https:\/\/ico\.org\.uk" rel="noopener">web<\/a>/);
  assert.match(html, /<a href="mailto:privacy@squish\.online" rel="noopener">mail<\/a>/);
  assert.ok(!html.includes('href="javascript:'), 'a javascript: URL became a link');
});

test('the published policy names a real controller and a reachable address', () => {
  // A policy with a placeholder where the controller should be is worse than
  // none: it looks finished. This fails the day somebody blanks either.
  const html = render(readFileSync('docs/privacy.md', 'utf8'));
  assert.ok(html.includes('Industry Logic Limited'), 'the data controller is not named');
  assert.match(html, /<a href="mailto:[^"]+@[^"]+" rel="noopener">/, 'there is no tappable contact address');
  assert.ok(!/\[your [a-z ]+\]/i.test(html), 'a placeholder is still on the published page');
});

test('bold and code survive', () => {
  const html = render('That is **special category data**, held in `docs/privacy.md`.');
  assert.match(html, /<strong>special category data<\/strong>/);
  assert.match(html, /<code>docs\/privacy\.md<\/code>/);
});

test('a page reached from an email does not send people into an empty Squish', async () => {
  const { standalonePage } = await import('../server/privacy');
  assert.match(standalonePage('<p>x</p>'), /Back to Squish/, 'the policy lost its way back');
  assert.doesNotMatch(standalonePage('<p>x</p>', 'Confirmed', 'd', { back: false }), /Back to Squish/);
  const route = readFileSync('server/index.ts', 'utf8');
  const verify = route.slice(route.indexOf("app.get('/verify'"), route.indexOf('const escapeHtml'));
  assert.match(verify, /back: false/, 'the confirmation page links back into the app again');
});
