/**
 * Translating the app's interface, once, for everybody.
 *
 * The English strings live in src/i18n/catalog.json, collected from the
 * source by scripts/i18n-extract.ts. When somebody's app asks for a
 * language, this hands back every string already translated and, if any are
 * missing, has Claude translate them in the background — in batches, checked,
 * and stored so no string is ever paid for twice. A string that changes in
 * English gets a new id, so it is translated again; one that does not, never.
 *
 * Checked, because a translation that drops `{n}` or a `<b>` would break a
 * sentence on screen: any that does not carry exactly the English's
 * placeholders and tags is thrown away and the English is shown until the
 * next attempt. English is always the fallback, so nothing here can leave a
 * blank on anybody's screen.
 *
 * At start-up the server works through every language in turn, so after a
 * deploy the new strings are ready before most people open the app.
 *
 * The same store serves the emails and the website. Their English is not in
 * the app's catalog — the app has no use for it — so they register it here
 * when the server starts (`registerStrings`), and it is translated alongside.
 * An email wording edited in the dashboard is new English, translated the
 * first time somebody needs it in another language (`translationsFor`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { hasDatabase, query } from './db';
import { LANGUAGES, isLanguage, type Language } from '../src/lib/language';
import { localeFor, speaker, type PluralForms, type Speaker, type Translation } from '../src/lib/i18n';
import { REGIONS, isRegion } from '../src/lib/region';

export interface CatalogEntry {
  id: string;
  text?: string;
  one?: string;
  other?: string;
  where: string[];
}

export interface Catalog {
  version: string;
  entries: CatalogEntry[];
}

export const CATALOG: Catalog = JSON.parse(readFileSync(join(import.meta.dirname, '../src/i18n/catalog.json'), 'utf8'));

/** Every language but English, which is the catalog itself. */
export const TRANSLATED_LANGUAGES = (Object.keys(LANGUAGES) as Language[]).filter((l) => l !== 'en');

export const BATCH = 60;

// ---- What there is to translate --------------------------------------------------------------

/** English from outside the app's catalog: the emails and the website. */
const extra = new Map<string, CatalogEntry>();

/** Add strings to translate with everything else. Safe to call with ones already known. */
export function registerStrings(entries: CatalogEntry[]): void {
  for (const entry of entries) {
    const known = extra.get(entry.id);
    if (known) {
      for (const where of entry.where) if (!known.where.includes(where)) known.where.push(where);
    } else if (!CATALOG.entries.some((e) => e.id === entry.id)) {
      extra.set(entry.id, { ...entry, where: [...entry.where] });
    }
  }
}

/** Everything the server keeps translated: the app's catalog, then the emails and the website. */
export const wanted = (): CatalogEntry[] => [...CATALOG.entries, ...extra.values()];

// ---- Checking a translation ---------------------------------------------------------------

const placeholdersOf = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tagsOf = (text: string) => [...text.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort();
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const unique = (a: string[]) => [...new Set(a)].sort();

/** The plural categories a language needs, as Intl knows them. */
export function pluralCategories(language: string): Intl.LDMLPluralRule[] {
  try {
    return new Intl.PluralRules(language).resolvedOptions().pluralCategories as Intl.LDMLPluralRule[];
  } catch {
    return ['one', 'other'];
  }
}

/**
 * Whether a translation can be shown in place of the English: the same
 * placeholders and the same tags, nothing empty. A plural's forms may each
 * leave out `{n}` (Arabic's "one" often does), but may not bring in a
 * placeholder the English never had, and every form the language needs must
 * be there.
 */
export function acceptable(entry: CatalogEntry, value: unknown, language: string): value is Translation {
  if (entry.text !== undefined) {
    if (typeof value !== 'string' || !value.trim()) return false;
    return same(placeholdersOf(value), placeholdersOf(entry.text)) && same(tagsOf(value), tagsOf(entry.text));
  }
  if (!value || typeof value !== 'object') return false;
  const forms = value as Record<string, unknown>;
  const allowed = unique([...placeholdersOf(entry.one ?? ''), ...placeholdersOf(entry.other ?? ''), 'n']);
  const tags = tagsOf(entry.other ?? '');
  for (const category of pluralCategories(language)) {
    const form = forms[category];
    if (typeof form !== 'string' || !form.trim()) return false;
    if (!unique(placeholdersOf(form)).every((p) => allowed.includes(p))) return false;
    if (!same(tagsOf(form), tags)) return false;
  }
  return true;
}

// ---- Storage ---------------------------------------------------------------------------------

/** Without a database (local development), translations live as long as the process. */
const memory = new Map<string, Map<string, Translation>>();

/**
 * What was read from the database, for a few minutes: every page of the
 * website and every email would otherwise read a language's whole table.
 * What this process translates is added as it is stored; what another
 * instance translated shows up when the copy runs out.
 */
const recent = new Map<Language, { at: number; found: Map<string, Translation> }>();
const FRESH_MS = 5 * 60_000;

async function stored(language: Language): Promise<Map<string, Translation>> {
  if (!hasDatabase()) return memory.get(language) ?? new Map();
  const copy = recent.get(language);
  if (copy && Date.now() - copy.at < FRESH_MS) return copy.found;
  const rows = await query<{ id: string; value: Translation }>('select id, value from ui_translations where language = $1', [language]);
  const found = new Map(rows.map((row) => [row.id, row.value]));
  recent.set(language, { at: Date.now(), found });
  return found;
}

/** Forget the copies, for a test that changed the table underneath. */
export const forgetStored = (): void => recent.clear();

async function store(language: Language, found: Map<string, Translation>): Promise<void> {
  if (!found.size) return;
  if (!hasDatabase()) {
    const known = memory.get(language) ?? new Map();
    for (const [id, value] of found) known.set(id, value);
    memory.set(language, known);
    return;
  }
  const ids = [...found.keys()];
  await query(
    `insert into ui_translations (language, id, value)
     select $1, id, value from unnest($2::text[], $3::jsonb[]) as t(id, value)
     on conflict (language, id) do nothing`,
    [language, ids, ids.map((id) => JSON.stringify(found.get(id)))],
  );
  const copy = recent.get(language);
  if (copy) for (const [id, value] of found) if (!copy.found.has(id)) copy.found.set(id, value);
}

// ---- Translating -----------------------------------------------------------------------------

export type Translator = (entries: CatalogEntry[], language: Language) => Promise<Record<string, unknown>>;

let translator: Translator | null = null;

/** The Claude-backed translator is set by index.ts when there are credentials; tests set their own. */
export function setTranslator(next: Translator | null): void {
  translator = next;
}

/**
 * Translate these, a batch at a time, keeping the ones that pass the check.
 * Stops at the first failure: what is left waits for the next attempt.
 */
async function translateEntries(language: Language, entries: CatalogEntry[]): Promise<Map<string, Translation>> {
  const added = new Map<string, Translation>();
  if (!translator) return added;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    try {
      const answer = await translator(batch, language);
      const good = new Map<string, Translation>();
      for (const entry of batch) {
        const value = answer[entry.id];
        if (acceptable(entry, value, language)) good.set(entry.id, value);
      }
      await store(language, good);
      for (const [id, value] of good) added.set(id, value);
    } catch (error) {
      console.error(`Translating into ${language} failed:`, error instanceof Error ? error.message : error);
      break;
    }
  }
  return added;
}

const running = new Map<Language, Promise<number>>();

/**
 * Translate whatever is missing for a language. One run per language at a
 * time: a second request while it runs waits for the same one.
 */
export function fillLanguage(language: Language): Promise<number> {
  const current = running.get(language);
  if (current) return current;
  const run = (async () => {
    if (!translator) return 0;
    const have = await stored(language);
    const missing = wanted().filter((entry) => !have.has(entry.id));
    return (await translateEntries(language, missing)).size;
  })().finally(() => running.delete(language));
  running.set(language, run);
  return run;
}

/**
 * The translations of these strings, translating any that are missing there
 * and then — for an email, which cannot be sent later in a better language.
 * Waits at most `waitMs` for Claude; whatever is not back by then is left
 * out, and shows in English.
 */
export async function translationsFor(language: Language, entries: CatalogEntry[], waitMs = 20_000): Promise<Map<string, Translation>> {
  const have = await stored(language);
  const out = new Map<string, Translation>();
  const missing: CatalogEntry[] = [];
  for (const entry of entries) {
    const value = have.get(entry.id);
    if (value !== undefined) out.set(entry.id, value);
    else if (!missing.some((m) => m.id === entry.id)) missing.push(entry);
  }
  if (missing.length && translator && waitMs > 0) {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<Map<string, Translation>>((resolve) => {
      timer = setTimeout(() => resolve(new Map()), waitMs);
    });
    const got = await Promise.race([translateEntries(language, missing), late]).finally(() => clearTimeout(timer));
    for (const [id, value] of got) out.set(id, value);
  }
  return out;
}

/**
 * `t` and `plural` in somebody's language, on the server: for an email, or a
 * page of the website. Uses what is translated already and never waits.
 * The region makes the numbers and dates local ("es-US").
 */
export async function speakerFor(language: Language, region?: string): Promise<Speaker> {
  const regionLocale = REGIONS[isRegion(region) ? region : 'GB'].locale;
  const locale = localeFor(language, regionLocale);
  if (language === 'en') return speaker({ language, locale, lookup: () => undefined });
  const have = await stored(language).catch(() => new Map<string, Translation>());
  return speaker({ language, locale, lookup: (id) => have.get(id) });
}

export interface LanguagePack {
  language: Language;
  version: string;
  /** False while strings are still missing; the app keeps asking. */
  complete: boolean;
  messages: Record<string, Translation>;
}

/** What the app gets for a language: what is ready now, and a nudge to translate the rest. */
export async function languagePack(language: Language): Promise<LanguagePack> {
  const have = await stored(language);
  const messages: Record<string, Translation> = {};
  for (const entry of CATALOG.entries) {
    const value = have.get(entry.id);
    if (value !== undefined) messages[entry.id] = value;
  }
  const complete = Object.keys(messages).length === CATALOG.entries.length;
  if (!complete) void fillLanguage(language);
  return { language, version: CATALOG.version, complete, messages };
}

export const isTranslatable = (value: unknown): value is Language => isLanguage(value) && value !== 'en';

/** Every language in turn, after a deploy. Never throws; a failure waits for the next request. */
export async function warmAll(): Promise<void> {
  for (const language of TRANSLATED_LANGUAGES) {
    try {
      const added = await fillLanguage(language);
      if (added) console.log(`    Translated ${added} interface strings into ${LANGUAGES[language].name}.`);
    } catch {
      /* tried again when somebody asks */
    }
  }
}

// ---- The prompt ------------------------------------------------------------------------------

export const TRANSLATE_SYSTEM = `You translate the interface of Squish, a friendly food-tracking app with a small round blob mascot called Squish. People log meals, see their calories and nutrients, earn badges, plan meals and ask an AI nutritionist questions.

How to translate:
- Warm, plain, everyday language, as a good native app would say it — not a word-for-word rendering of the English. Short where the English is short: many of these are buttons and labels on a phone.
- Address the person informally where the language distinguishes (tu, du, tú), as friendly apps do.
- Never moralise about food; keep the English's kindness and lightness.
- Keep every {placeholder} exactly as written, and every <tag> and </tag> around the words that belong inside it. You may move them to where the sentence needs them.
- Do not translate: Squish, Squish Plus, units (kcal, kJ, g, mg, ml, kg, lb), emoji.
- Source strings are British English. Use the standard form of the target language that is widely understood.
- "where" says which screen a string is used on, for context. Some strings come from the Squish website ("site/…") or from an email Squish sends ("email: …"): translate those as a good native website or email would read — full sentences, still warm and plain. HTML tags there may be numbered, like <a1> or <span2>: keep each exactly as it is, around the same words. Keep web and email addresses, company details and prices exactly as written.

For counted strings you get the English "one" and "other" forms and must give every plural form the target language uses, in the categories listed. Each form may use {n} for the number.`;

export function translateRequest(entries: CatalogEntry[], language: Language, model: string): Anthropic.MessageCreateParamsNonStreaming {
  const lang = LANGUAGES[language];
  const categories = pluralCategories(language);
  const strings = entries.filter((e) => e.text !== undefined).map((e) => ({ id: e.id, english: e.text, where: e.where.join(', ') }));
  const plurals = entries.filter((e) => e.text === undefined).map((e) => ({ id: e.id, one: e.one, other: e.other, where: e.where.join(', ') }));
  const schema = {
    type: 'object',
    properties: {
      strings: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false },
      },
      plurals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            forms: {
              type: 'object',
              properties: Object.fromEntries(categories.map((c) => [c, { type: 'string' }])),
              required: categories,
              additionalProperties: false,
            },
          },
          required: ['id', 'forms'],
          additionalProperties: false,
        },
      },
    },
    required: ['strings', 'plurals'],
    additionalProperties: false,
  };
  return {
    model,
    max_tokens: 16000,
    system: TRANSLATE_SYSTEM,
    thinking: { type: 'disabled' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    messages: [
      {
        role: 'user',
        content: `Translate into ${lang.name} (${lang.native}). Plural categories for ${lang.name}: ${categories.join(', ')}.\n\n${JSON.stringify({ strings, plurals })}`,
      },
    ],
  };
}

/** Pull the model's answer into id → translation. */
export function readTranslation(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as { strings?: { id: string; text: string }[]; plurals?: { id: string; forms: PluralForms }[] };
  const out: Record<string, unknown> = {};
  for (const s of parsed.strings ?? []) out[s.id] = s.text;
  for (const p of parsed.plurals ?? []) out[p.id] = p.forms;
  return out;
}
