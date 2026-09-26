import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import {
  BATCH,
  CATALOG,
  acceptable,
  fillLanguage,
  languagePack,
  pluralCategories,
  readTranslation,
  translateRequest,
  useTranslator,
  type CatalogEntry,
} from '../server/translate';

/**
 * Translating the interface: checked before it is kept, kept once, and
 * English wherever a translation is missing or wrong.
 */
before(async () => {
  if (hasDatabase()) {
    await migrate();
    await query(`delete from ui_translations where language in ('pl', 'cy', 'de')`);
  }
});
after(async () => {
  useTranslator(null);
  if (hasDatabase()) {
    await query(`delete from ui_translations where language in ('pl', 'cy', 'de')`);
    await closeDatabase();
  }
});

const text = (english: string): CatalogEntry => ({ id: 'x', text: english, where: [] });
const counted: CatalogEntry = { id: 'p', one: '{n} day', other: '{n} days', where: [] };

test('a translation keeps every placeholder and tag, or it is not used', () => {
  const entry = text('<b>{price}</b> a month');
  assert.ok(acceptable(entry, '<b>{price}</b> al mes', 'es'));
  assert.ok(acceptable(entry, 'al mes: <b>{price}</b>', 'es'), 'moved is fine');
  assert.ok(!acceptable(entry, '<b>{precio}</b> al mes', 'es'), 'a renamed placeholder');
  assert.ok(!acceptable(entry, '{price} al mes', 'es'), 'a lost tag');
  assert.ok(!acceptable(entry, '  ', 'es'), 'nothing');
  assert.ok(!acceptable(entry, { other: 'x' }, 'es'));
});

test('a plural needs every form its language has', () => {
  assert.deepEqual(pluralCategories('pl'), ['few', 'many', 'one', 'other']);
  assert.ok(acceptable(counted, { one: '{n} dzień', few: '{n} dni', many: '{n} dni', other: '{n} dnia' }, 'pl'));
  assert.ok(!acceptable(counted, { one: '{n} dzień', other: '{n} dni' }, 'pl'), 'Polish needs few and many');
  assert.ok(acceptable(counted, { zero: 'لا أيام', one: 'يوم واحد', two: 'يومان', few: '{n} أيام', many: '{n} يومًا', other: '{n} يوم' }, 'ar'), 'a form may leave out the number');
  assert.ok(!acceptable(counted, { one: '{n} Tag', other: '{m} Tage' }, 'de'), 'but may not invent a placeholder');
});

test('the request lists the plural categories and asks for them in the schema', () => {
  const request = translateRequest([text('Log a meal'), counted], 'cy', 'claude-opus-5');
  const content = request.messages[0].content as string;
  assert.match(content, /Welsh \(Cymraeg\)/);
  for (const category of pluralCategories('cy')) assert.match(content, new RegExp(category));
  assert.match(JSON.stringify(request.output_config), /"required":\["few","many","one","two","zero","other"\]/);
  assert.deepEqual(readTranslation('{"strings":[{"id":"x","text":"Cofnodi pryd"}],"plurals":[]}'), { x: 'Cofnodi pryd' });
});

test('missing strings are translated in batches, checked, and kept; broken ones stay English', async () => {
  if (!CATALOG.entries.length) return;
  const calls: number[] = [];
  useTranslator(async (entries) => {
    calls.push(entries.length);
    const out: Record<string, unknown> = {};
    entries.forEach((entry, i) => {
      if (entry.text !== undefined) out[entry.id] = i === 0 ? 'drops the placeholders {nope}' : `DE ${entry.text}`;
      else out[entry.id] = { one: `DE ${entry.one}`, other: `DE ${entry.other}` };
    });
    return out;
  });
  await fillLanguage('de');
  assert.ok(calls.every((n) => n <= BATCH));
  assert.equal(calls.reduce((a, b) => a + b, 0), CATALOG.entries.length);

  const pack = await languagePack('de');
  const kept = Object.keys(pack.messages).length;
  assert.ok(kept > 0);
  assert.ok(kept < CATALOG.entries.length, 'the broken one in each batch was thrown out');
  assert.equal(pack.complete, false);
  // Anything the check threw out is simply absent, and the app shows English for it.
  for (const [id, value] of Object.entries(pack.messages)) {
    const entry = CATALOG.entries.find((e) => e.id === id)!;
    assert.ok(acceptable(entry, value, 'de'), `kept ${id} though it failed the check`);
  }

  // A second run asks only for what is still missing.
  calls.length = 0;
  await fillLanguage('de');
  assert.equal(calls.reduce((a, b) => a + b, 0), CATALOG.entries.length - Object.keys(pack.messages).length);
});

test('two requests at once share one run', async () => {
  let running = 0;
  let most = 0;
  useTranslator(async (entries) => {
    running++;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return Object.fromEntries(entries.map((e) => [e.id, e.text ?? { zero: 'a', one: 'b', two: 'c', few: 'd', many: 'e', other: 'f' }]));
  });
  await Promise.all([fillLanguage('cy'), fillLanguage('cy'), languagePack('cy')]);
  assert.equal(most, CATALOG.entries.length ? 1 : 0);
});

test('with no translator there is nothing to do, and English is what shows', async () => {
  useTranslator(null);
  assert.equal(await fillLanguage('pl'), 0);
  const pack = await languagePack('pl');
  assert.equal(pack.complete, CATALOG.entries.length === 0);
  assert.equal(pack.version, CATALOG.version);
});
