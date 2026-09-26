/**
 * The app's own words, in the language somebody chose.
 *
 * Every string a person reads goes through `t` (or `plural`, or `rich` in
 * lib/i18n-react.tsx) with its British English as the key. That English is
 * the source of truth: it is what the extraction script collects into
 * src/i18n/catalog.json, what the server hands to Claude to translate, and
 * what anybody sees for a string not yet translated.
 *
 * The catalog for their language is loaded before the rest of the app is
 * even imported (see main.tsx), so `t` works at module level — a table of
 * achievement titles can be translated where it is defined. The price is
 * that changing language reloads the page, which is a fine thing for a
 * setting changed once.
 *
 * DOM-free and dependency-free, so the server, the tests and the
 * extraction script can all use it. Outside the browser nothing is loaded
 * and everything comes back in English.
 */

export type Vars = Record<string, string | number>;
/** A plural's forms, by Intl.PluralRules category. English needs `one` and `other`. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Translation = string | PluralForms;

/** The made-up language that turns every string into accented look-alikes, to find ones missed. */
export const PSEUDO = 'qps';

let language = 'en';
let locale = 'en-GB';
let messages: Record<string, Translation> = {};

/**
 * A short, stable name for a string: two 32-bit FNV-1a hashes, so a
 * catalog of thousands does not collide. Changing the English changes the
 * id, which is what makes the server translate it afresh.
 */
export function idOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b ^= b >>> 15;
  }
  return a.toString(36).padStart(7, '0') + b.toString(36).padStart(7, '0');
}

/** A plural's key: both English forms, so changing either retranslates it. */
export const pluralKey = (forms: { one: string; other: string }) => `${forms.one}␞${forms.other}`;

export function setLanguage(next: { language: string; locale: string; messages?: Record<string, Translation> }): void {
  language = next.language;
  locale = next.locale;
  messages = next.messages ?? {};
  current = speaker({ language, locale, lookup: (id) => messages[id] });
}

export const uiLanguage = () => language;
/** For Intl: their language, in their country where that is a real locale ("es-US"). */
export const uiLocale = () => locale;

/** Fill `{name}` from vars; anything not given is left as written. */
export const fill = (text: string, vars?: Vars): string => fillFor(text, vars, locale);

function fillFor(text: string, vars: Vars | undefined, loc: string): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in vars)) return whole;
    const value = vars[name];
    return typeof value === 'number' ? value.toLocaleString(loc) : value;
  });
}

/**
 * Accented look-alikes of every letter, with the placeholders and tags left
 * alone, and brackets round the whole so truncation shows too. Readable
 * enough to use the app in; unmistakable next to anything left in English.
 */
const PSEUDO_MAP: Record<string, string> = {
  a: 'ä', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

export function pseudo(text: string): string {
  if (!text.trim()) return text;
  const out = text.replace(/(\{\w+\}|<\/?\w+>)|([A-Za-z])/g, (_m, keep: string | undefined, letter: string | undefined) =>
    keep ?? PSEUDO_MAP[letter!] ?? letter!,
  );
  return `[${out}]`;
}

/** What `t` and `plural` need: a language, a locale for numbers, and the translations. */
export interface Speaker {
  language: string;
  locale: string;
  t: (english: string, vars?: Vars) => string;
  plural: (n: number, forms: { one: string; other: string }, vars?: Vars) => string;
}

/**
 * `t` and `plural` for one language. The app has one, set at start-up; the
 * server makes one for each email it writes, in the reader's language.
 */
export function speaker(next: { language: string; locale: string; lookup: (id: string) => Translation | undefined }): Speaker {
  const { language: lang, locale: loc, lookup } = next;
  const fillIn = (text: string, vars?: Vars) => fillFor(text, vars, loc);
  const find = (key: string) => lookup(idOf(key));
  return {
    language: lang,
    locale: loc,
    t(english, vars) {
      if (lang === 'en' || !english) return fillIn(english, vars);
      if (lang === PSEUDO) return fillIn(pseudo(english), vars);
      const found = find(english);
      return fillIn(typeof found === 'string' ? found : english, vars);
    },
    plural(n, forms, vars) {
      const all = { n, ...vars };
      const english = n === 1 ? forms.one : forms.other;
      if (lang === 'en') return fillIn(english, all);
      if (lang === PSEUDO) return fillIn(pseudo(english), all);
      const found = find(pluralKey(forms));
      if (!found || typeof found === 'string') return fillIn(english, all);
      let rule: Intl.LDMLPluralRule = 'other';
      try {
        rule = new Intl.PluralRules(loc).select(n);
      } catch {
        /* an unknown locale: "other" is always there */
      }
      return fillIn(found[rule] ?? found.other, all);
    },
  };
}

let current: Speaker = speaker({ language, locale, lookup: () => undefined });

/**
 * A string in their language: `t('Log a meal')`, `t('{n} kcal left', { n })`.
 * Also used on a string held in a variable, when that string was collected
 * elsewhere (a server message marked with `msg`, a table of names).
 */
export const t = (english: string, vars?: Vars): string => current.t(english, vars);

/**
 * A count with its noun, in whichever plural form their language wants for
 * it: `plural(n, { one: '{n} day', other: '{n} days' })`. English has two
 * forms; Polish and Arabic have more, and the translation carries them all.
 * `{n}` is always available, formatted for their locale.
 */
export const plural = (n: number, forms: { one: string; other: string }, vars?: Vars): string => current.plural(n, forms, vars);

/**
 * Marks a string for translation without translating it: for a message the
 * server sends in English that the app translates on arrival with `t(text)`,
 * or a value compared against before it is shown.
 */
export const msg = (english: string): string => english;

/** A counted string kept in a table, for `plural(n, forms)` later. Marks it for the catalog. */
export const pluralForms = (forms: { one: string; other: string }) => forms;

/** Whether the page should run right to left. */
export const RTL_LANGUAGES = new Set(['ar', 'ur']);

/**
 * The locale to format with: their language in their country if Intl knows
 * it, else the language alone. English keeps the country's own English.
 */
export function localeFor(language: string, regionLocale: string): string {
  if (language === 'en' || language === PSEUDO) return regionLocale;
  const region = regionLocale.split('-')[1];
  for (const candidate of [`${language}-${region}`, language]) {
    try {
      if (Intl.NumberFormat.supportedLocalesOf([candidate]).length) return candidate;
    } catch {
      /* try the next */
    }
  }
  return regionLocale;
}
