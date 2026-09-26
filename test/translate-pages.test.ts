import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { stringsOf, translateHtml } from '../server/htmlWords';
import { fillLanguage, forgetStored, setTranslator, wanted } from '../server/translate';
import { acceptLanguage, readerFromRequest, readerOf, rememberReader, zoneFrom } from '../server/reader';
import { compose, EMAILS } from '../server/emails';
import { describeDevice, when } from '../server/notices';
import { rewardWords } from '../server/friends';
import { languageOfPath, registerSiteStrings, siteRouter } from '../server/site';
import { privacyPage, registerPrivacyStrings } from '../server/privacy';
import { speaker } from '../src/lib/i18n';

/**
 * The emails and the website, in the reader's language: translated from the
 * same store as the app, checked the same way, English wherever a
 * translation is missing — and never at the cost of a link.
 */
const LANGS = ['ko', 'ga'];
/** A stand-in for Claude that marks every string, keeping its tags and placeholders. */
const korean = async (entries: { id: string; text?: string; one?: string; other?: string }[]) =>
  Object.fromEntries(entries.map((e) => [e.id, e.text !== undefined ? `KO:${e.text}` : { other: `KO:${e.other}` }]));

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

test('the plans show the price in the currency of the country the browser names', async () => {
  const american = await fetch(`${base}/`, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  assert.match(american.headers.get('vary') ?? '', /Accept-Language/);
  const html = await american.text();
  assert.match(html, /<p class="price">\$0<\/p>/);
  assert.match(html, /<p class="price">\$7\.99 <small>a month, or \$59\.99 a year<\/small><\/p>/);
  assert.match(html, /<a href="\?country=US#plans" aria-current="true">/);
  assert.doesNotMatch(html, /\{monthly\}|\{yearly\}|\{free\}|<!--countries-->/);

  const british = await (await fetch(`${base}/`)).text();
  assert.match(british, /£6\.99 <small>a month, or £49\.99 a year/, 'Britain where the browser names nowhere');
});

test('a country picked under the plans wins over the browser, in any language', async () => {
  const irish = await (await fetch(`${base}/support?country=ie`, { headers: { 'Accept-Language': 'en-US' } })).text();
  assert.match(irish, /Plus is €7\.99 a month or €57\.99 a year/);

  const korean = await (await fetch(`${base}/ko/?country=AU`)).text();
  assert.match(korean, /KO:A\$11\.99 <small>a month, or A\$84\.99 a year<\/small>|KO:AU\$11\.99 <small>a month, or AU\$84\.99 a year<\/small>/);
  assert.match(korean, /<span aria-hidden="true">🇳🇿<\/span> /, 'every other country is a tap away');

  const unknown = await (await fetch(`${base}/?country=FR`, { headers: { 'Accept-Language': 'en-CA' } })).text();
  assert.match(unknown, /<p class="price">\$9\.99 /, 'a country Squish does not sell in is ignored');
});

test('the price sentences reach the translator with their placeholders, not a currency', () => {
  const site = wanted().filter((e) => e.where.some((w) => w.startsWith('site/')));
  assert.ok(site.some((e) => e.text === '{monthly} <small>a month, or {yearly} a year</small>'));
  assert.ok(!site.some((e) => e.text === '{free}'), 'a bare placeholder is nothing to translate');
  assert.ok(!site.some((e) => /£/.test(e.text ?? '')), 'no pounds left in the pages');
});
