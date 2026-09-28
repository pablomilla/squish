import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { render, termsPage } from '../server/privacy';
import { privacyHref, privacyRedirect } from '../server/site';

/**
 * The terms of use: one markdown file, served as a page that opens for
 * somebody with nothing installed, linked wherever somebody commits to
 * anything, and agreeing with the privacy policy and the app on the facts.
 */

test('the terms render with every section, and keep their notes to the maintainer off the page', async () => {
  const source = readFileSync('docs/terms.md', 'utf8');
  const html = render(source);
  const headings = [...source.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  assert.ok(headings.length >= 12, `only ${headings.length} sections`);
  for (const heading of headings) assert.ok(html.includes(`<h2>${heading.replace(/&/g, '&amp;')}</h2>`), `lost "${heading}"`);
  assert.ok(!html.includes('solicitor'), 'the note about a solicitor is for us, not the page');

  const page = await termsPage('en', 'GB');
  assert.ok(page);
  assert.match(page, /<title>Terms of use — Squish<\/title>/);
});

test('the terms say the things a subscription and a health app must', () => {
  const terms = readFileSync('docs/terms.md', 'utf8');
  assert.match(terms, /18 or over/);
  assert.match(terms, /not medical advice/i);
  assert.match(terms, /Always check labels and ingredients\s+yourself/);
  assert.match(terms, /renews automatically/);
  assert.match(terms, /Deleting the app, or your Squish account, does not cancel a subscription/);
  assert.match(terms, /death or\s+personal injury/);
  assert.match(terms, /Industry Logic Limited/);
  // The same floor the app will not go below (src/lib/nutrition.ts).
  assert.match(terms, /1,200 kcal/);
  assert.match(terms, /1,500 for men/);
});

test('the policy and the terms point at each other, and both are read at the website address', () => {
  assert.match(readFileSync('docs/terms.md', 'utf8'), /squish\.online\/privacy/);
  process.env.SQUISH_SITE_ORIGIN = 'https://squish.online';
  assert.equal(privacyRedirect('app.squish.online', '/terms'), 'https://squish.online/terms');
  assert.equal(privacyRedirect('squish.online', '/terms'), null);
  delete process.env.SQUISH_SITE_ORIGIN;
  assert.equal(privacyHref('en', 'US', '/terms'), '/terms?lang=en&amp;country=US');
  assert.equal(privacyHref('es', 'GB', '/terms'), '/terms?lang=es');
});

test('the terms are linked wherever somebody commits to something', () => {
  for (const file of ['site/index.html', 'site/support.html']) assert.match(readFileSync(file, 'utf8'), /href="\/terms"/, file);
  assert.match(readFileSync('src/screens/Onboarding.tsx', 'utf8'), /legalHref\('\/terms'\)/, 'at making an account');
  assert.match(readFileSync('src/components/Paywall.tsx', 'utf8'), /legalHref\('\/terms'\)/, 'on the upgrade screen');
  assert.match(readFileSync('site/sitemap.xml', 'utf8'), /squish\.online\/terms/);
});
