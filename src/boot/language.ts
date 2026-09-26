/**
 * Choosing the interface language, before anything else is imported.
 *
 * main.tsx calls this and only then imports the app, so every module that
 * translates a string at load time finds the catalog already in place. It
 * reads the saved profile straight out of localStorage for that reason:
 * importing the store would import half the app.
 *
 * The catalog comes from the server (which has Claude translate anything new
 * once, for everybody) and is kept in localStorage. With a copy there, the
 * app starts at once from it and fetches a fresher one in the background for
 * next time. Without one — the first launch in a language — it waits a few
 * seconds behind the splash screen, and starts in English for anything the
 * server could not supply in that time.
 */
import { PSEUDO, localeFor, setLanguage, RTL_LANGUAGES, type Translation } from '../lib/i18n';
import { browserLanguage, isLanguage, languageOf } from '../lib/language';
import { REGIONS, browserRegion, regionOf, type Region } from '../lib/region';
import { apiUrl } from '../lib/origin';
import { CATALOG_VERSION } from '../i18n/version';

interface Saved {
  profile?: { language?: string; region?: Region; onboarded?: boolean };
}

interface Cached {
  version: string;
  complete: boolean;
  messages: Record<string, Translation>;
}

const WAIT_MS = 6000;
const cacheKey = (language: string) => `squish-i18n:${language}`;

function savedProfile(): Saved['profile'] {
  try {
    return (JSON.parse(localStorage.getItem('squish-v1') ?? '{}') as { state?: Saved }).state?.profile;
  } catch {
    return undefined;
  }
}

/** `?lang=qps` switches to the pseudo-language for a check; it is not offered anywhere. */
function forced(): string | null {
  try {
    const value = new URL(location.href).searchParams.get('lang');
    return value === PSEUDO || isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

function readCache(language: string): Cached | null {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey(language)) ?? 'null') as Cached | null;
    return cached && typeof cached.messages === 'object' ? cached : null;
  } catch {
    return null;
  }
}

function writeCache(language: string, value: Cached): void {
  try {
    localStorage.setItem(cacheKey(language), JSON.stringify(value));
  } catch {
    /* storage full or blocked: the next launch fetches again */
  }
}

async function fetchCatalog(language: string, timeoutMs: number): Promise<Cached | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl(`/api/i18n/${language}?v=${CATALOG_VERSION}`), { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as Cached;
    return body && typeof body.messages === 'object' ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function chooseLanguage(): Promise<void> {
  const profile = savedProfile();
  // Somebody who has not set up yet has not chosen: their browser's language is the best guess, as in onboarding.
  const chosen = profile && (profile.onboarded || profile.language);
  const language = forced() ?? (chosen ? languageOf(profile as { language?: never }) : browserLanguage());
  const region = profile?.region ? regionOf(profile) : browserRegion();
  const locale = localeFor(language, REGIONS[region].locale);

  document.documentElement.lang = language === PSEUDO ? 'en' : locale;
  document.documentElement.dir = RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';

  if (language === 'en' || language === PSEUDO) {
    setLanguage({ language, locale });
    return;
  }

  const cached = readCache(language);
  if (cached) {
    setLanguage({ language, locale, messages: cached.messages });
    // Fresher for next time, if the app has changed or the last copy was partial.
    if (cached.version !== CATALOG_VERSION || !cached.complete) {
      void fetchCatalog(language, 60_000).then((fresh) => fresh && writeCache(language, fresh));
    }
    return;
  }

  const fresh = await fetchCatalog(language, WAIT_MS);
  setLanguage({ language, locale, messages: fresh?.messages ?? {} });
  if (fresh) writeCache(language, fresh);
  // Partial on a first launch: keep asking in the background, for next launch.
  if (!fresh?.complete) void keepAsking(language);
}

async function keepAsking(language: string, tries = 10): Promise<void> {
  for (let i = 0; i < tries; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    const fresh = await fetchCatalog(language, 30_000);
    if (!fresh) continue;
    writeCache(language, fresh);
    if (fresh.complete) return;
  }
}
