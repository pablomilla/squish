import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FetchGuardError, assertPublicUrl, isPrivateAddress } from '../server/fetch-guard';
import { pageAsText, recipeFromJsonLd, recipePrompt } from '../server/recipe';

/* ------------------------------------------------------------------ *
 * The guard. A server that fetches any address it is given is a way in.
 * ------------------------------------------------------------------ */

test('the addresses that are not the public internet are all refused', () => {
  const private_ = [
    '127.0.0.1', '127.9.9.9', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '192.0.0.1', '198.18.0.1',
    '224.0.0.1', '240.0.0.1', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1',
  ];
  for (const ip of private_) assert.ok(isPrivateAddress(ip), `${ip} should be refused`);
});

test('169.254.169.254 in particular — that is the cloud metadata service', () => {
  assert.ok(isPrivateAddress('169.254.169.254'));
  assert.ok(isPrivateAddress('::ffff:169.254.169.254'), 'and dressed up as IPv6');
});

test('an IPv4 address wearing an IPv6 costume is still that address', () => {
  assert.ok(isPrivateAddress('::ffff:127.0.0.1'));
  assert.ok(isPrivateAddress('::ffff:10.0.0.1'));
  assert.equal(isPrivateAddress('::ffff:93.184.216.34'), false, 'a public one still passes');
});

test('ordinary public addresses are allowed through', () => {
  for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:2800:220:1::1']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} should be allowed`);
  }
});

test('the edges of each range are where they should be', () => {
  assert.ok(isPrivateAddress('172.16.0.0'), 'first of 172.16/12');
  assert.ok(isPrivateAddress('172.31.255.255'), 'last of it');
  assert.equal(isPrivateAddress('172.15.255.255'), false, 'one before');
  assert.equal(isPrivateAddress('172.32.0.0'), false, 'one after');
  assert.ok(isPrivateAddress('100.64.0.0'));
  assert.equal(isPrivateAddress('100.63.255.255'), false);
  assert.equal(isPrivateAddress('100.128.0.0'), false);
});

test('nonsense is not quietly treated as public', () => {
  for (const junk of ['999.1.1.1', '1.2.3', 'not-an-ip', '1.2.3.4.5']) {
    assert.equal(isPrivateAddress(junk), false, `${junk} is not a private address either`);
  }
});

const refuses = async (url: string, why: RegExp) => {
  await assert.rejects(() => assertPublicUrl(url), (error: unknown) => {
    assert.ok(error instanceof FetchGuardError, `${url} should be refused with a guard error`);
    assert.match(error.message, why);
    return true;
  });
};

test('only ordinary web links get through the front door', async () => {
  await refuses('file:///etc/passwd', /ordinary web links/i);
  await refuses('ftp://example.com/x', /ordinary web links/i);
  await refuses('javascript:alert(1)', /ordinary web links/i);
  await refuses('data:text/html,<p>hi', /ordinary web links/i);
  await refuses('not a url at all', /web address/i);
});

test('credentials in a link are refused rather than passed on', async () => {
  await refuses('http://admin:hunter2@example.com/', /username or password/i);
});

test('localhost by name is refused, not just by address', async () => {
  await refuses('http://localhost:8787/api/health', /public internet/i);
  await refuses('http://127.0.0.1/', /public internet/i);
  await refuses('http://[::1]/', /public internet/i);
});

/* ------------------------------------------------------------------ *
 * Getting the recipe out of the page.
 * ------------------------------------------------------------------ */

const page = (jsonLd: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body><p>hi</p></body></html>`;

test('a plain schema.org Recipe is read straight off the page', () => {
  const found = recipeFromJsonLd(page({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Leek and potato soup',
    recipeYield: 'Serves 4',
    recipeIngredient: ['2 leeks', '500g potatoes', '1 litre stock'],
  }));

  assert.equal(found?.title, 'Leek and potato soup');
  assert.equal(found?.yieldText, 'Serves 4');
  assert.deepEqual(found?.ingredients, ['2 leeks', '500g potatoes', '1 litre stock']);
});

test('a recipe buried in an @graph is found too — that is how most sites ship it', () => {
  const found = recipeFromJsonLd(page({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'A Food Blog' },
      { '@type': 'Person', name: 'The Author' },
      { '@type': ['Recipe', 'NewsArticle'], name: 'Dal', recipeIngredient: ['200g red lentils'], recipeYield: 2 },
    ],
  }));

  assert.equal(found?.title, 'Dal');
  assert.equal(found?.yieldText, '2', 'a numeric yield is kept as words');
  assert.deepEqual(found?.ingredients, ['200g red lentils']);
});

test('a Recipe stub with no ingredients is skipped for the real one', () => {
  const found = recipeFromJsonLd(
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Teaser' })}</script>` +
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'The real one', recipeIngredient: ['1 egg'] })}</script>`,
  );
  assert.equal(found?.title, 'The real one');
});

test('one broken block does not lose the others', () => {
  const found = recipeFromJsonLd(
    '<script type="application/ld+json">{ not json at all }</script>' +
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Soup', recipeIngredient: ['water'] })}</script>`,
  );
  assert.equal(found?.title, 'Soup');
});

test('a page with no recipe on it says so', () => {
  assert.equal(recipeFromJsonLd('<html><body>just a blog post</body></html>'), null);
  assert.equal(recipeFromJsonLd(page({ '@type': 'NewsArticle', name: 'Not a recipe' })), null);
});

test('the prose fallback drops the furniture and keeps the words', () => {
  const text = pageAsText(`
    <html><head><style>.a{color:red}</style><script>var x = "eat me";</script></head>
    <body><nav>Home</nav><h1>Soup</h1><!-- a comment --><p>Two&nbsp;leeks &amp; a potato.</p></body></html>
  `);

  assert.ok(!text.includes('color:red'), 'no stylesheets');
  assert.ok(!text.includes('eat me'), 'no scripts');
  assert.ok(!text.includes('a comment'), 'no comments');
  assert.ok(!text.includes('<'), 'no tags');
  assert.match(text, /Soup Two leeks & a potato\./);
});

test('the prose fallback is capped, because recipe pages are enormous', () => {
  assert.equal(pageAsText(`<p>${'word '.repeat(50_000)}</p>`).length, 12_000);
});

/* ------------------------------------------------------------------ *
 * What the model is actually handed.
 * ------------------------------------------------------------------ */

test('an ingredient list is sent as a list, not as a wall of page', () => {
  const prompt = recipePrompt({
    url: 'https://example.com/soup',
    title: 'Soup',
    yieldText: 'Serves 4',
    ingredients: ['2 leeks', '500g potatoes'],
  });

  assert.match(prompt, /Title: Soup/);
  assert.match(prompt, /Stated yield: Serves 4/);
  assert.match(prompt, /- 2 leeks/);
  assert.match(prompt, /ONE serving/);
});

test('with no ingredient list, the page text goes instead', () => {
  const prompt = recipePrompt({ url: 'https://example.com/x', ingredients: [], text: 'Mix flour and water.' });
  assert.match(prompt, /Mix flour and water\./);
  assert.match(prompt, /no structured recipe/i);
});
