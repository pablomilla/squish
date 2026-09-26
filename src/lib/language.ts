/**
 * The language Squish's AI writes in.
 *
 * Separate from the country on purpose. Somebody in Texas may want Spanish,
 * somebody in Montréal French, somebody in Cardiff Welsh — and they still
 * shop in their own country, read its labels and count its units. So the
 * region decides the food and the numbers; this decides the words.
 *
 * What it covers is everything the AI writes: meal and food names, the
 * coach's notes, the nutritionist's replies, weekly plans. The app's own
 * buttons and headings stay English until the interface itself is
 * translated. Kept free of the DOM, like lib/region.ts.
 */
import type { Region } from './region';

export type Language =
  | 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'nl' | 'pl' | 'ro' | 'el' | 'tr'
  | 'cy' | 'ga' | 'mi'
  | 'ar' | 'ur' | 'hi' | 'pa' | 'bn'
  | 'zh' | 'ja' | 'ko' | 'vi' | 'tl';

export interface LanguageInfo {
  id: Language;
  /** In English, for the prompt. */
  name: string;
  /** In itself, for the picker. */
  native: string;
  /** Written right to left, so text from the AI needs its direction set. */
  rtl?: boolean;
  /** For voice input: the recogniser's locale, where the country makes no difference. */
  speech: string;
}

/*
 * The languages most spoken at home in the six countries after English —
 * Spanish in the US, Polish and Punjabi in Britain, Mandarin and Arabic in
 * Australia, Tagalog in Canada — plus the three that belong to them: Welsh,
 * Irish and te reo Māori.
 */
export const LANGUAGES: Record<Language, LanguageInfo> = {
  en: { id: 'en', name: 'English', native: 'English', speech: 'en-GB' },
  es: { id: 'es', name: 'Spanish', native: 'Español', speech: 'es-ES' },
  fr: { id: 'fr', name: 'French', native: 'Français', speech: 'fr-FR' },
  de: { id: 'de', name: 'German', native: 'Deutsch', speech: 'de-DE' },
  it: { id: 'it', name: 'Italian', native: 'Italiano', speech: 'it-IT' },
  pt: { id: 'pt', name: 'Portuguese', native: 'Português', speech: 'pt-PT' },
  nl: { id: 'nl', name: 'Dutch', native: 'Nederlands', speech: 'nl-NL' },
  pl: { id: 'pl', name: 'Polish', native: 'Polski', speech: 'pl-PL' },
  ro: { id: 'ro', name: 'Romanian', native: 'Română', speech: 'ro-RO' },
  el: { id: 'el', name: 'Greek', native: 'Ελληνικά', speech: 'el-GR' },
  tr: { id: 'tr', name: 'Turkish', native: 'Türkçe', speech: 'tr-TR' },
  cy: { id: 'cy', name: 'Welsh', native: 'Cymraeg', speech: 'cy-GB' },
  ga: { id: 'ga', name: 'Irish', native: 'Gaeilge', speech: 'ga-IE' },
  mi: { id: 'mi', name: 'Māori', native: 'Te reo Māori', speech: 'mi-NZ' },
  ar: { id: 'ar', name: 'Arabic', native: 'العربية', rtl: true, speech: 'ar-SA' },
  ur: { id: 'ur', name: 'Urdu', native: 'اردو', rtl: true, speech: 'ur-PK' },
  hi: { id: 'hi', name: 'Hindi', native: 'हिन्दी', speech: 'hi-IN' },
  pa: { id: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', speech: 'pa-IN' },
  bn: { id: 'bn', name: 'Bengali', native: 'বাংলা', speech: 'bn-IN' },
  zh: { id: 'zh', name: 'Chinese (Simplified)', native: '中文（简体）', speech: 'zh-CN' },
  ja: { id: 'ja', name: 'Japanese', native: '日本語', speech: 'ja-JP' },
  ko: { id: 'ko', name: 'Korean', native: '한국어', speech: 'ko-KR' },
  vi: { id: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', speech: 'vi-VN' },
  tl: { id: 'tl', name: 'Tagalog (Filipino)', native: 'Tagalog', speech: 'fil-PH' },
};

/** English first, then the rest by their own names. */
export const LANGUAGE_LIST: LanguageInfo[] = [
  LANGUAGES.en,
  ...Object.values(LANGUAGES)
    .filter((l) => l.id !== 'en')
    .sort((a, b) => a.name.localeCompare(b.name)),
];

export const isLanguage = (value: unknown): value is Language => typeof value === 'string' && value in LANGUAGES;

/**
 * A new person's language from their browser's: the first one Squish can
 * write in. "fil" is how some phones name Tagalog, and "iw"-style old codes
 * are not worth chasing.
 */
export function detectLanguage(languages: readonly string[] | string | undefined): Language {
  const list = typeof languages === 'string' ? [languages] : (languages ?? []);
  for (const tag of list) {
    const base = tag.split(/[-_]/)[0]?.toLowerCase();
    if (base === 'fil') return 'tl';
    if (isLanguage(base)) return base;
  }
  return 'en';
}

export function browserLanguage(): Language {
  const nav = (globalThis as { navigator?: { language?: string; languages?: readonly string[] } }).navigator;
  return detectLanguage(nav?.languages?.length ? nav.languages : nav?.language);
}

/** A profile from before languages existed was using the app in English. */
export function languageOf(profile: { language?: Language }): Language {
  return isLanguage(profile.language) ? profile.language : 'en';
}

/**
 * The recogniser's locale for dictation: their language, as spoken in their
 * country where that is a recognised variety (Mexican-American Spanish,
 * Québécois French) and English in the country's own accent.
 */
export function speechLocale(language: Language, region: Region, regionLocale: string): string {
  if (language === 'en') return regionLocale;
  if (language === 'es' && region === 'US') return 'es-US';
  if (language === 'fr' && region === 'CA') return 'fr-CA';
  return LANGUAGES[language].speech;
}

// ---- The current language, kept in step by the store -------------------------------------

let current: Language = 'en';

export function setCurrentLanguage(profile: { language?: Language }): void {
  current = languageOf(profile);
}

export const currentLanguage = (): LanguageInfo => LANGUAGES[current];
