import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { fill, idOf, localeFor, plural, pluralKey, pseudo, setLanguage, t } from '../src/lib/i18n';
import { CATALOG_PATH, VERSION_PATH, extract, versionModule } from '../scripts/i18n-extract';

/**
 * The interface's words: looked up by their English, filled with named
 * values, counted properly in languages with more than two plural forms, and
 * collected into a catalog the server translates.
 */
afterEach(() => setLanguage({ language: 'en', locale: 'en-GB' }));

test('English is the key, and comes back as written', () => {
  assert.equal(t('Log a meal'), 'Log a meal');
  assert.equal(t('{n} kcal left', { n: 1850 }), '1,850 kcal left');
  assert.equal(fill('Hello {name}, {missing}', { name: 'Sam' }), 'Hello Sam, {missing}');
});

test('a translation is found by its English, and missing ones fall back to it', () => {
  setLanguage({ language: 'es', locale: 'es-ES', messages: { [idOf('Log a meal')]: 'Registrar una comida' } });
  assert.equal(t('Log a meal'), 'Registrar una comida');
  assert.equal(t('Something new'), 'Something new');
});

test('plurals use their language’s own forms', () => {
  const forms = { one: '{n} day', other: '{n} days' };
  assert.equal(plural(1, forms), '1 day');
  assert.equal(plural(3, forms), '3 days');
  setLanguage({
    language: 'pl',
    locale: 'pl-PL',
    messages: { [idOf(pluralKey(forms))]: { one: '{n} dzień', few: '{n} dni', many: '{n} dni', other: '{n} dnia' } },
  });
  assert.equal(plural(1, forms), '1 dzień');
  assert.equal(plural(3, forms), '3 dni');
  assert.equal(plural(5, forms), '5 dni');
});

test('the pseudo-language changes the letters and nothing a program relies on', () => {
  const out = pseudo('Hello <b>{name}</b>, you have {n} days');
  assert.match(out, /^\[.*\]$/);
  assert.match(out, /<b>\{name\}<\/b>/);
  assert.match(out, /\{n\}/);
  assert.doesNotMatch(out, /Hello/);
  setLanguage({ language: 'qps', locale: 'en-GB' });
  assert.equal(t('Hi {name}', { name: 'Sam' }), '[Ĥî Sam]');
});

test('ids are stable, short and distinct', () => {
  assert.equal(idOf('Log a meal'), idOf('Log a meal'));
  assert.notEqual(idOf('Log a meal'), idOf('Log a meal.'));
  assert.equal(idOf('x').length, 14);
});

test('the locale is their language in their country, where there is one', () => {
  assert.equal(localeFor('en', 'en-AU'), 'en-AU');
  assert.equal(localeFor('es', 'en-US'), 'es-US');
  assert.equal(localeFor('fr', 'en-CA'), 'fr-CA');
});

test('the catalog is up to date with the source, and every string is whole', () => {
  const { catalog, problems } = extract();
  assert.deepEqual(problems, [], 'strings built from pieces');
  const committed = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  assert.equal(committed.version, catalog.version, 'run `npm run i18n` and commit src/i18n');
  assert.equal(readFileSync(VERSION_PATH, 'utf8'), versionModule(catalog.version));
});
