import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { stringsOf, translateHtml } from '../server/htmlWords';
import { acceptable, fillLanguage, forgetStored, setTranslator, wanted } from '../server/translate';
import { acceptLanguage, readerFromRequest, readerOf, rememberReader, zoneFrom } from '../server/reader';
import { compose, EMAILS } from '../server/emails';
import { describeDevice, when } from '../server/notices';
import { rewardWords } from '../server/friends';
import { languageOfPath, registerSiteStrings, siteRouter } from '../server/site';
import { privacyPage, registerPrivacyStrings } from '../server/privacy';
import { speaker } from '../src/lib/i18n';
import { AMERICAN_WORDS, standInAmerican } from './standInAmerican';

/**
 * The emails and the website, in the reader's language: translated from the
 * same store as the app, checked the same way, English wherever a
 * translation is missing — and never at the cost of a link.
 */
const LANGS = ['ko', 'ga', 'en-US'];
/** American English, as the stand-in makes it (test/standInAmerican.ts), and one marker to tell an email by. */
const american = (text: string) => standInAmerican(text).replace(/^Confirm your/, 'Confirm (US) your');
/** A stand-in for Claude that marks every string, keeping its tags and placeholders — and spells American for en-US. */
const korean = async (entries: { id: string; text?: string; one?: string; other?: string }[], pack?: string) =>
  Object.fromEntries(
    entries.map((e) =>
      pack === 'en-US'
        ? [e.id, e.text !== undefined ? american(e.text) : { one: american(e.one!), other: american(e.other!) }]
        : [e.id, e.text !== undefined ? `KO:${e.text}` : { other: `KO:${e.other}` }],
    ),
  );

let server: ReturnType<ReturnType<typeof express>['listen']> | null = null;
let base = '';

before(async () => {
  if (hasDatabase()) {
    await migrate();
    await query('delete from ui_translations where language = any($1)', [LANGS]);
  }
  forgetStored();
  registerSiteStrings();
  registerPrivacyStrings();
  setTranslator(korean);
  await fillLanguage('ko');
  await fillLanguage('en-US');

  process.env.SQUISH_SITE_ORIGIN = 'http://127.0.0.1';
  const app = express();
  app.use(siteRouter(() => 'https://app.squish.online', 'dist'));
  app.use((_req, res) => res.status(418).end());
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});

after(async () => {
  setTranslator(null);
  delete process.env.SQUISH_SITE_ORIGIN;
  server?.close();
  if (hasDatabase()) {
    await query('delete from ui_translations where language = any($1)', [LANGS]);
    await closeDatabase();
  }
});

/* ---------------- pages of HTML ---------------- */

test('a page is read as whole sentences, with its markup as tags a translator can move', () => {
  const html = `<!doctype html><html lang="en-GB"><head><title>Hello — Squish</title>
<meta name="description" content="What it does &amp; why"></head><body>
<nav aria-label="Main"><a href="/support">Support</a></nav>
<p>Open <a href="https://app.squish.online">app.squish.online</a> in <b>any</b> browser.</p>
<div class="icon">📸</div><span class="plan-badge">Plus</span>
<img src="/x.png" alt="Squish's home screen" />
<script>var nope = 'Not this';</script>
</body></html>`;
  assert.deepEqual(stringsOf(html), [
    'Hello — Squish',
    'What it does & why',
    'Main',
    'Support',
    'Open <a1>app.squish.online</a1> in <b>any</b> browser.',
    "Squish's home screen",
  ]);
});

test('a translation keeps every link where it went, and cannot bring in markup of its own', () => {
  const html = '<p>Open <a href="https://app.squish.online" class="x">the app</a> now.</p><img alt="A plate" src="p.png">';
  const out = translateHtml(html, (english) =>
    ({
      'Open <a1>the app</a1> now.': 'Ahora <a1>abre la app</a1> & <img src=x onerror=alert(1)>',
      'A plate': 'Un "plato"',
    })[english],
  );
  assert.match(out, /<p>Ahora <a href="https:\/\/app\.squish\.online" class="x">abre la app<\/a> &amp; &lt;img src=x onerror=alert\(1\)&gt;<\/p>/);
  assert.match(out, /alt="Un &quot;plato&quot;"/);
  // Nothing translated: the page exactly as it was.
  assert.equal(translateHtml(html, () => undefined), html);
});

test('every page of the website and the privacy policy has strings to translate', () => {
  const site = wanted().filter((e) => e.where.some((w) => w.startsWith('site/')));
  assert.ok(site.some((e) => e.text === 'Your little health\u00a0buddy.'), 'entities are the characters they stand for');
  assert.ok(site.some((e) => e.text === 'Nothing here'));
  assert.ok(site.some((e) => e.text === 'How do I start?'));
  assert.ok(site.some((e) => e.where.includes('site/privacy')));
  assert.ok(site.some((e) => e.text?.startsWith('Welcome back, {name}')), 'the words move.js uses are on the page');
});

/* ---------------- the website's addresses ---------------- */

test('a language in the address is that language; anything else is not a language', () => {
  assert.deepEqual(languageOfPath('/es/support'), { language: 'es', rest: '/support' });
  assert.deepEqual(languageOfPath('/es/'), { language: 'es', rest: '/' });
  assert.deepEqual(languageOfPath('/es'), { language: 'es', rest: '' });
  assert.deepEqual(languageOfPath('/support'), { language: null, rest: '/support' });
  assert.deepEqual(languageOfPath('/xx/support'), { language: null, rest: '/xx/support' });
});

test('the browser’s first language Squish has, by its weights', () => {
  assert.equal(acceptLanguage('pt-BR,pt;q=0.9,en;q=0.8'), 'pt');
  assert.equal(acceptLanguage('en-US,en;q=0.9,es;q=0.8'), 'en');
  assert.equal(acceptLanguage('xx,fil;q=0.5,es;q=0.1'), 'tl');
  assert.equal(acceptLanguage('de;q=0.2,ko;q=0.9'), 'ko');
  assert.equal(acceptLanguage('*'), 'en');
  assert.equal(acceptLanguage(undefined), 'en');
});

test('/ko/support is the page in Korean, and every link on it stays in Korean', async () => {
  const response = await fetch(`${base}/ko/support`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<html lang="ko" dir="ltr">/);
  assert.match(html, /<h1>KO:Support<\/h1>/);
  assert.match(html, /<p>KO:Open <a href="https:\/\/app\.squish\.online\/\?lang=ko">app\.squish\.online<\/a> in any browser/, 'the link inside a sentence kept its address');
  assert.match(html, /href="\/ko\/support"/);
  assert.match(html, /href="\/privacy\?lang=ko"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/squish\.online\/ko\/support" \/>/);
  assert.match(html, /hreflang="x-default" href="http:\/\/127\.0\.0\.1\/support"/);
  assert.match(html, /<a href="\/es\/support" hreflang="es" lang="es">Español<\/a>/);
  assert.match(html, /aria-current="page">한국어<\/a>/);
  assert.match(html, /href="https:\/\/app\.squish\.online\/partners"/, 'the partner page is for the business, and stays as it was');
});

test('/ is the browser’s language, and says that it varies by it', async () => {
  const korean = await fetch(`${base}/`, { headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  assert.match(korean.headers.get('vary') ?? '', /Accept-Language/);
  assert.match(await korean.text(), /<h1>KO:Your little health\u00a0buddy\.<\/h1>/);

  const english = await (await fetch(`${base}/`)).text();
  assert.match(english, /<h1>Your little health&nbsp;buddy\.<\/h1>/);
  assert.match(english, /<a class="brand" href="\/"/, 'English links stay plain');
  assert.match(english, /<a href="\/ko\/" hreflang="ko" lang="ko">한국어<\/a>/, 'and the other languages are a tap away');

  const fixed = await fetch(`${base}/en/`, { headers: { 'Accept-Language': 'ko' } });
  assert.match(await fixed.text(), /<h1>Your little health&nbsp;buddy\.<\/h1>/, 'choosing English sticks, whatever the browser says');
});

test('/ko is sent to /ko/, and a language with nothing translated yet is English', async () => {
  const bare = await fetch(`${base}/ko`, { redirect: 'manual' });
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get('location'), '/ko/');

  setTranslator(null);
  const irish = await (await fetch(`${base}/ga/support`)).text();
  setTranslator(korean);
  assert.match(irish, /<html lang="ga" dir="ltr">/);
  assert.match(irish, /<h1>Support<\/h1>/);
});

test('the privacy policy in Korean says the English is the one that counts', async () => {
  const html = (await privacyPage('ko'))!;
  assert.match(html, /<html lang="ko" dir="ltr">/);
  assert.match(html, /KO:<em>This is a translation/);
  assert.match(html, /href="\/privacy\?lang=en"/);
  assert.doesNotMatch((await privacyPage('en'))!, /This is a translation/);
});

/* ---------------- emails ---------------- */

const KOREAN_READER = { language: 'ko' as const, region: 'GB' as const, zone: 'Asia/Seoul' };
const ORIGIN = 'https://app.squish.online';

test('a reset email in Korean: every line translated, the link still a button and still a link', async () => {
  const link = 'https://app.squish.online/reset?token=abc';
  const mail = await compose('reset', 'a@example.com', { link, hours: '2' }, ORIGIN, KOREAN_READER);
  assert.equal(mail.subject, 'KO:Reset your Squish password');
  assert.match(mail.text, /^KO:That link works for 2 hours and once only\.$/m);
  assert.match(mail.text, new RegExp(`^${link.replace(/[.?]/g, '\\$&')}$`, 'm'), 'the link is on its own line');
  assert.match(mail.html, /<html lang="ko" dir="ltr">/);
  assert.match(mail.html, />KO:Choose a new password<\/a>/);
  assert.match(mail.html, /KO:If the button doesn't work/);
  assert.match(mail.html, /privacy\?lang=ko/);
});

test('a line whose translation lost its placeholder goes out in English; the rest still translated', async () => {
  setTranslator(async (entries) =>
    Object.fromEntries(entries.map((e) => [e.id, e.text?.includes('{days}') ? 'Irish without the number' : `GA:${e.text}`])),
  );
  const mail = await compose('verify', 'a@example.com', { link: `${ORIGIN}/verify?token=x`, days: '7' }, ORIGIN, {
    ...KOREAN_READER,
    language: 'ga',
  });
  setTranslator(korean);
  assert.equal(mail.subject, 'GA:Confirm your email for Squish');
  assert.match(mail.text, /^That link works for 7 days\.$/m);
});

test('the partner and test emails are for the business, and stay in English', async () => {
  assert.equal(EMAILS['partner-signin'].translated, false);
  const mail = await compose('partner-signin', 'p@example.com', { name: 'Sam', link: `${ORIGIN}/partners#token=x`, expiry: '30 minutes' }, ORIGIN, KOREAN_READER);
  assert.equal(mail.subject, 'Your Squish partner page');
  assert.match(mail.html, /<html lang="en-GB"/);
});

test('when something happened is on the reader’s own clock, in their language', () => {
  const at = new Date('2026-09-23T13:41:00Z');
  assert.match(when({ zone: 'Europe/London' }, { locale: 'en-GB' }, at), /Wednesday 23 September at 14:41 BST/);
  const spanish = when({ zone: 'America/New_York' }, { locale: 'es-US' }, at);
  assert.match(spanish, /miércoles/);
  assert.match(spanish, /09:41/);
  assert.match(spanish, /EDT|GMT-4/);
});

test('the device and the reward are written in the reader’s language', () => {
  const words = speaker({
    language: 'es',
    locale: 'es-ES',
    lookup: () => undefined,
  });
  // No translation yet: the English, with the numbers and date in Spanish.
  assert.equal(describeDevice('Mozilla/5.0 (iPhone) Safari/605.1', words), 'Safari on iPhone');
  assert.match(rewardWords('started', 30, new Date('2027-11-03T12:00:00Z'), words), /until 3 de noviembre de 2027/);

  const marked = speaker({ language: 'es', locale: 'es-ES', lookup: () => 'ES:{browser} en {system}' });
  assert.equal(describeDevice('Mozilla/5.0 (iPhone) Safari/605.1', marked), 'ES:Safari en iPhone');
});

/* ---------------- what the app says about its reader ---------------- */

test('only a real language, country and time zone are kept from the headers', () => {
  const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] });
  assert.deepEqual(
    readerFromRequest(headers({ 'x-squish-language': 'es', 'x-squish-region': 'US', 'x-squish-zone': 'America/Chicago' }) as never),
    { language: 'es', region: 'US', zone: 'America/Chicago' },
  );
  assert.deepEqual(readerFromRequest(headers({ 'x-squish-language': 'xx', 'x-squish-region': 'FR', 'x-squish-zone': 'Mars/Olympus' }) as never), {});
  assert.equal(zoneFrom('Europe/London'), 'Europe/London');
  assert.equal(zoneFrom('../../etc'), null);
  assert.equal(zoneFrom(42), null);
});

test('the default wordings are translated ahead of time, so an email waits on nobody', async () => {
  let asked = 0;
  setTranslator(async (entries) => {
    asked += entries.length;
    return korean(entries);
  });
  const before = asked;
  // The defaults were translated ahead of time: nothing more to ask for.
  await compose('signin', 'a@example.com', { device: 'Safari on Mac', time: 'now', app_link: ORIGIN }, ORIGIN, KOREAN_READER);
  assert.equal(asked, before);
  setTranslator(korean);
});

test('an account keeps the language, country and time zone its app last said', async () => {
  if (!hasDatabase()) return;
  const id = `reader-test-${Date.now()}`;
  await query(`insert into accounts (id, email, password_hash) values ($1, $2, 'x')`, [id, `${id}@example.com`]);
  try {
    assert.deepEqual(await readerOf(id), { language: 'en', region: 'GB', zone: 'Europe/London' }, 'nothing said yet');
    assert.deepEqual(await readerOf(id, { language: 'es' }), { language: 'es', region: 'GB', zone: 'Europe/London' }, 'the asker, until it has');

    await rememberReader(id, { language: 'es', region: 'US', zone: 'America/Chicago' });
    assert.deepEqual(await readerOf(id, { language: 'fr' }), { language: 'es', region: 'US', zone: 'America/Chicago' });

    // A call that says only its language keeps the rest; one that says nothing changes nothing.
    await rememberReader(id, { language: 'pl' });
    await rememberReader(id, {});
    assert.deepEqual(await readerOf(id), { language: 'pl', region: 'US', zone: 'America/Chicago' });
  } finally {
    await query('delete from accounts where id = $1', [id]);
  }
});

/* ---------------- prices where they live ---------------- */

/** A page with its prices unmarked, to read as a person would. */
const unmarked = (html: string) => html.replace(/<span data-price="\w+">([^<]*)<\/span>/g, '$1');

test('the plans show the price in the currency of the country the browser names', async () => {
  const american = await fetch(`${base}/`, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  assert.match(american.headers.get('vary') ?? '', /Accept-Language/);
  const html = unmarked(await american.text());
  assert.match(html, /<p class="price">\$0<\/p>/);
  assert.match(html, /<p class="price">\$7\.99 <small>a month, or \$59\.99 a year<\/small><\/p>/);
  assert.match(html, /<a href="\?country=US#plans" data-country="US" aria-current="true">/);
  assert.doesNotMatch(html, /\{monthly\}|\{yearly\}|\{free\}|<!--countries-->/);

  const british = unmarked(await (await fetch(`${base}/`)).text());
  assert.match(british, /£6\.99 <small>a month, or £49\.99 a year/, 'Britain where the browser names nowhere');
});

test('a country picked under the plans wins over the browser, in any language', async () => {
  const irish = unmarked(await (await fetch(`${base}/support?country=ie`, { headers: { 'Accept-Language': 'en-US' } })).text());
  assert.match(irish, /Plus is €7\.99 a month or €57\.99 a year/);

  const korean = unmarked(await (await fetch(`${base}/ko/?country=AU`)).text());
  assert.match(korean, /KO:A\$11\.99 <small>a month, or A\$84\.99 a year<\/small>|KO:AU\$11\.99 <small>a month, or AU\$84\.99 a year<\/small>/);
  assert.match(korean, /<span aria-hidden="true">🇳🇿<\/span> /, 'every other country is a tap away');

  const unknown = unmarked(await (await fetch(`${base}/?country=FR`, { headers: { 'Accept-Language': 'en-CA' } })).text());
  assert.match(unknown, /<p class="price">\$9\.99 /, 'a country Squish does not sell in is ignored');
});

test('the price sentences reach the translator with their placeholders, not a currency', () => {
  const site = wanted().filter((e) => e.where.some((w) => w.startsWith('site/')));
  assert.ok(site.some((e) => e.text === '{monthly} <small>a month, or {yearly} a year</small>'));
  assert.ok(!site.some((e) => e.text === '{free}'), 'a bare placeholder is nothing to translate');
  assert.ok(!site.some((e) => /£/.test(e.text ?? '')), 'no pounds left in the pages');
});

test('the page carries every country’s prices for the time zone guess, and says when one was picked', async () => {
  const read = async (url: string, headers: Record<string, string> = {}) => {
    const html = await (await fetch(url, { headers })).text();
    const block = /<script type="application\/json" id="prices-data">([^<]*)<\/script>/.exec(html);
    assert.ok(block, `no prices data on ${url}`);
    assert.match(html, /<script src="\/prices\.js" defer><\/script>/);
    return { html, data: JSON.parse(block[1]) as { region: string; picked: boolean; words: Record<string, string | null>; prices: Record<string, Record<string, string>>; zones: Record<string, string[]> } };
  };

  const guessed = await read(`${base}/`, { 'Accept-Language': 'en-US' });
  assert.equal(guessed.data.region, 'US');
  assert.equal(guessed.data.picked, false);
  assert.deepEqual(guessed.data.prices.GB, { free: '£0', monthly: '£6.99', yearly: '£49.99' });
  assert.deepEqual(guessed.data.prices.NZ, { free: '$0', monthly: '$12.99', yearly: '$89.99' });
  assert.ok(guessed.data.zones.GB.includes('Europe/London'));
  assert.match(guessed.html, /<span data-price="monthly">\$7\.99<\/span>/);

  const picked = await read(`${base}/support?country=CA`);
  assert.equal(picked.data.picked, true, 'a picked country is left alone');
  assert.equal(picked.data.region, 'CA');

  // Written in the page's language, like the prices it replaces.
  const canadianFrench = await read(`${base}/fr/`, { 'Accept-Language': 'fr-CA' });
  assert.match(canadianFrench.data.prices.CA.monthly, /^9,99\s\$$/);

  // Every page carries it, prices or not: the spelling may need the clock's guess too.
  const notFound = await (await fetch(`${base}/nope`)).text();
  assert.match(notFound, /prices-data/);
  assert.equal(guessed.data.words.US, 'en-US');
  assert.equal(guessed.data.words.CA, null, 'Canada reads the British');
});

/* ---------------- American English ---------------- */

test('an English email to somebody in the US is in American English; in Canada it stays British', async () => {
  const link = `${ORIGIN}/verify?token=x`;
  const american = await compose('verify', 'a@example.com', { link, days: '7' }, ORIGIN, { language: 'en', region: 'US', zone: 'America/Chicago' });
  assert.equal(american.subject, 'Confirm (US) your email for Squish');
  assert.match(american.html, /<html lang="en-US"/);
  const canadian = await compose('verify', 'a@example.com', { link, days: '7' }, ORIGIN, { language: 'en', region: 'CA', zone: 'America/Toronto' });
  assert.equal(canadian.subject, 'Confirm your email for Squish');
  assert.match(canadian.html, /<html lang="en-CA"/);
  // The business's emails are British wherever they go.
  const partner = await compose('partner-signin', 'p@example.com', { name: 'Sam', link, expiry: '30 minutes' }, ORIGIN, { language: 'en', region: 'US', zone: 'America/Chicago' });
  assert.match(partner.html, /<html lang="en-GB"/);
});

test('the website is in American English for the US, and British everywhere else', async () => {
  const us = await (await fetch(`${base}/`, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } })).text();
  assert.match(us, /<html lang="en-US" dir="ltr">/);
  assert.match(us, /calories, protein, fiber and more/);
  assert.doesNotMatch(us, /\bfibre\b/);

  const canadian = await (await fetch(`${base}/`, { headers: { 'Accept-Language': 'en-CA' } })).text();
  assert.match(canadian, /<html lang="en-GB" dir="ltr">/);
  assert.match(canadian, /calories, protein, fibre and more/);

  // A country picked under the plans decides the spelling too, in English only.
  assert.match(await (await fetch(`${base}/?country=US`)).text(), /fiber and more/);
  assert.match(await (await fetch(`${base}/?country=GB`, { headers: { 'Accept-Language': 'en-US' } })).text(), /fibre and more/);
  assert.match(await (await fetch(`${base}/ko/?country=US`)).text(), /<html lang="ko"/, 'another language is itself in the US');
});

test('the clock’s guess comes back as a guess, which can be guessed again; a pick cannot', async () => {
  const guess = await (await fetch(`${base}/?country=GB&guess`, { headers: { 'Accept-Language': 'en-US' } })).text();
  assert.match(guess, /fibre and more/, 'the page is for the guessed country');
  assert.match(guess, /"region":"GB","picked":false/);
  const pick = await (await fetch(`${base}/?country=GB`)).text();
  assert.match(pick, /"region":"GB","picked":true/);
});

test('the clock is read in the head, before the page is drawn, so a reload never shows the wrong page', async () => {
  const html = await (await fetch(`${base}/`, { headers: { 'Accept-Language': 'en-US' } })).text();
  const head = html.slice(0, html.indexOf('</head>'));
  const data = head.indexOf('id="prices-data"');
  const guess = head.indexOf('<script>/*\n * The country this device’s clock is set to'.replace('’', "'"));
  assert.ok(data > 0, 'the data is in the head');
  assert.ok(guess > data, 'and the guess runs straight after it, inline');
  assert.match(head, /root\.style\.visibility = 'hidden'/, 'hidden before it goes');
  assert.match(head, /setTimeout\(function \(\) \{\n\s+root\.style\.visibility = '';/, 'and never left hidden');
  assert.ok(!html.slice(html.indexOf('</head>')).includes('prices-data'), 'once, not again in the body');
});

test('the privacy policy is American for the US, says the British counts, and is British for Canada', async () => {
  const us = (await privacyPage('en', 'US'))!;
  assert.match(us, /<html lang="en-US" dir="ltr">/);
  assert.match(us, /This is the policy with American spelling\./);
  assert.match(us, /href="\/privacy\?lang=en&amp;country=GB">British English version/);
  assert.match(us, /Frankfurt data center/, 'the policy itself is in the American words');
  assert.doesNotMatch(us, /data centre/);
  const canada = (await privacyPage('en', 'CA'))!;
  assert.match(canada, /<html lang="en-GB"/);
  assert.doesNotMatch(canada, /This is the policy with American spelling|This is a translation, to make/);
  assert.equal(canada, await privacyPage('en'), 'British English is the policy as written');
  assert.match(canada, /Frankfurt data centre/);
  assert.doesNotMatch((await privacyPage('ko', 'US'))!, /This is the policy with American spelling/, 'another language is itself in the US');
});

test('every link to the policy says the language, and in English the country', async () => {
  const us = await (await fetch(`${base}/`, { headers: { 'Accept-Language': 'en-US' } })).text();
  assert.match(us, /href="\/privacy\?lang=en&amp;country=US"/);
  const guessed = await (await fetch(`${base}/support?country=GB&guess`, { headers: { 'Accept-Language': 'en-US' } })).text();
  assert.match(guessed, /href="\/privacy\?lang=en&amp;country=GB"/, 'the clock’s guess goes along too');
  assert.match(await (await fetch(`${base}/ko/`)).text(), /href="\/privacy\?lang=ko"/);

  const link = `${ORIGIN}/verify?token=x`;
  const american = await compose('verify', 'a@example.com', { link, days: '7' }, ORIGIN, { language: 'en', region: 'US', zone: 'America/Chicago' });
  assert.match(american.text, /privacy\?lang=en&country=US/);
  const british = await compose('verify', 'a@example.com', { link, days: '7' }, ORIGIN, { language: 'en', region: 'GB', zone: 'Europe/London' });
  assert.match(british.text, /privacy\?lang=en&country=GB/);
});

test('the stand-in American words pass the same check as a real translation, for every string', () => {
  let changed = 0;
  for (const entry of wanted()) {
    const value = entry.text !== undefined ? standInAmerican(entry.text) : { one: standInAmerican(entry.one!), other: standInAmerican(entry.other!) };
    assert.ok(acceptable(entry, value, 'en-US'), `the stand-in broke ${entry.text ?? entry.other}`);
    if (JSON.stringify(value) !== JSON.stringify(entry.text ?? { one: entry.one, other: entry.other })) changed++;
  }
  assert.ok(changed > 30, `only ${changed} strings changed`);
  assert.equal(standInAmerican('Crisps and chips, or a Favourite biscuit? Ask your GP.'), 'Chips and fries, or a Favorite cookie? Ask your doctor.');
  assert.equal(standInAmerican('{n} tins of <b>sweetcorn</b>'), '{n} cans of <b>corn</b>');
  assert.equal(standInAmerican('tinsel and ginger'), 'tinsel and ginger', 'whole words only');
  assert.ok(Object.keys(AMERICAN_WORDS).length >= 50);
});

test('the website says family doctor in Canada, and GP where people say GP', async () => {
  const canada = await (await fetch(`${base}/support?country=CA`)).text();
  assert.match(canada, /please talk to your family doctor before tracking/);
  for (const country of ['GB', 'IE', 'AU', 'NZ']) {
    assert.match(await (await fetch(`${base}/support?country=${country}`)).text(), /please talk to your GP before tracking/, country);
  }
  // Only this page has a Canadian word, so only here does the clock's guess of Canada reload.
  const words = (html: string) => JSON.parse(/id="prices-data">([^<]*)</.exec(html)![1]).words as Record<string, string | null>;
  assert.equal(words(canada).CA, 'en-CA');
  assert.equal(words(canada).GB, null);
  assert.equal(words(await (await fetch(`${base}/?country=CA`)).text()).CA, null, 'the home page reads the same in Canada');
});
