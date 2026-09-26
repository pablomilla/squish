/**
 * Where somebody lives, and what that changes.
 *
 * Squish was written in British English for British shoppers: kcal, salt in
 * grams, stones and pounds, crisps and chips. Six English-speaking countries
 * share the language but not the packet, and each difference here is one a
 * person would notice within a minute of opening the app:
 *
 * - **Money.** The price in their own currency, not pounds converted in
 *   their head.
 * - **Energy.** Australia and New Zealand print kilojoules first on every
 *   label, and count in them. Everyone else counts calories.
 * - **Salt.** British and Irish packets give salt in grams; American,
 *   Canadian, Australian and New Zealand ones give sodium in milligrams.
 *   Nutrition is stored as sodium either way (lib/units.ts), so this is only
 *   ever a question of how it is shown.
 * - **Bodies.** "Imperial" means stones in Britain and Ireland and plain
 *   pounds everywhere else — nobody in Ohio weighs 11 st 4.
 * - **Food.** Chips are fries in America and hot chips in Australia; crisps
 *   are chips in both. A food called by the wrong name reads as a foreign
 *   app, and is harder to find in search.
 *
 * Kept free of the DOM and of the store so it can be tested on its own. The
 * store tells this module which region is current (`setCurrentRegion`), which
 * is how formatters deep inside a chart know without every caller threading a
 * profile through.
 */

import { msg, t, uiLanguage, uiLocale } from './i18n';

export type Region = 'GB' | 'IE' | 'US' | 'CA' | 'AU' | 'NZ';
export type EnergyUnit = 'kcal' | 'kJ';
/** Which nutrition guidance a region's targets follow. */
export type Guidance = 'uk' | 'us' | 'anz';

export interface RegionInfo {
  id: Region;
  name: string;
  flag: string;
  /** For dates and numbers. */
  locale: string;
  currency: 'GBP' | 'EUR' | 'USD' | 'CAD' | 'AUD' | 'NZD';
  /**
   * What Plus costs there, for showing. Nothing is sold through the web app —
   * the stores take payment on a phone — so these are the prices the store
   * listings will be set to, kept here so the paywall says the same thing.
   */
  price: { monthly: number; yearly: number };
  energy: EnergyUnit;
  /** Salt in grams on the front of a packet, or sodium in milligrams. */
  salt: 'salt' | 'sodium';
  /** What "imperial" means for a body weight. */
  weight: 'stone' | 'pounds';
  /** The units a new person there starts on. */
  units: 'metric' | 'imperial';
  /** The fluid ounce they would mean, in millilitres. */
  fluidOunceMl: number;
  guidance: Guidance;
  /** For the AI: the variety of English to write in and the shops to have in mind. */
  english: string;
  shops: string;
}

export const REGIONS: Record<Region, RegionInfo> = {
  GB: {
    id: 'GB',
    name: msg('United Kingdom'),
    flag: '🇬🇧',
    locale: 'en-GB',
    currency: 'GBP',
    price: { monthly: 6.99, yearly: 49.99 },
    energy: 'kcal',
    salt: 'salt',
    weight: 'stone',
    units: 'metric',
    fluidOunceMl: 28.4130625,
    guidance: 'uk',
    english: 'British English',
    shops: 'a normal British supermarket',
  },
  IE: {
    id: 'IE',
    name: msg('Ireland'),
    flag: '🇮🇪',
    locale: 'en-IE',
    currency: 'EUR',
    price: { monthly: 7.99, yearly: 57.99 },
    energy: 'kcal',
    salt: 'salt',
    weight: 'stone',
    units: 'metric',
    fluidOunceMl: 28.4130625,
    guidance: 'uk',
    english: 'Irish English (British spelling)',
    shops: 'a normal Irish supermarket',
  },
  US: {
    id: 'US',
    name: msg('United States'),
    flag: '🇺🇸',
    locale: 'en-US',
    currency: 'USD',
    price: { monthly: 7.99, yearly: 59.99 },
    energy: 'kcal',
    salt: 'sodium',
    weight: 'pounds',
    units: 'imperial',
    fluidOunceMl: 29.5735295625,
    guidance: 'us',
    english: 'American English (American spelling and food words: fries, chips, cookies, ground beef, shrimp, zucchini, eggplant, cilantro)',
    shops: 'a normal American grocery store',
  },
  CA: {
    id: 'CA',
    name: msg('Canada'),
    flag: '🇨🇦',
    locale: 'en-CA',
    currency: 'CAD',
    price: { monthly: 9.99, yearly: 74.99 },
    energy: 'kcal',
    salt: 'sodium',
    weight: 'pounds',
    units: 'metric',
    fluidOunceMl: 29.5735295625,
    guidance: 'us',
    english: 'Canadian English (British-style spelling such as "fibre" and "colour", North American food words: fries, chips, cookies, ground beef, shrimp)',
    shops: 'a normal Canadian grocery store',
  },
  AU: {
    id: 'AU',
    name: msg('Australia'),
    flag: '🇦🇺',
    locale: 'en-AU',
    currency: 'AUD',
    price: { monthly: 11.99, yearly: 84.99 },
    energy: 'kJ',
    salt: 'sodium',
    weight: 'pounds',
    units: 'metric',
    fluidOunceMl: 28.4130625,
    guidance: 'anz',
    english: 'Australian English (British spelling; hot chips, chips for crisps, biscuits, capsicum, zucchini, mince, prawns)',
    shops: 'a normal Australian supermarket',
  },
  NZ: {
    id: 'NZ',
    name: msg('New Zealand'),
    flag: '🇳🇿',
    locale: 'en-NZ',
    currency: 'NZD',
    price: { monthly: 12.99, yearly: 89.99 },
    energy: 'kJ',
    salt: 'sodium',
    weight: 'pounds',
    units: 'metric',
    fluidOunceMl: 28.4130625,
    guidance: 'anz',
    english: 'New Zealand English (British spelling; hot chips, chips for crisps, biscuits, capsicum, courgette, kūmara, mince)',
    shops: 'a normal New Zealand supermarket',
  },
};

export const REGION_LIST: RegionInfo[] = (['GB', 'IE', 'US', 'CA', 'AU', 'NZ'] as const).map((id) => REGIONS[id]);

/** Where the app started, and where anybody it cannot place is assumed to be. */
export const HOME_REGION: Region = 'GB';

export const isRegion = (value: unknown): value is Region => typeof value === 'string' && value in REGIONS;

/**
 * A best guess from the browser's languages ("en-AU", "en-NZ"), for a new
 * person to confirm or change. The first language that names one of the six
 * wins; plain "en" names none of them, and a guess of Britain is no worse than
 * any other for somebody who never said.
 */
export function detectRegion(languages: readonly string[] | string | undefined): Region {
  const list = typeof languages === 'string' ? [languages] : (languages ?? []);
  for (const language of list) {
    const tag = language.split(/[-_]/)[1]?.toUpperCase();
    if (tag === 'UK') return 'GB';
    if (isRegion(tag)) return tag;
  }
  return HOME_REGION;
}

/**
 * The six countries' time zones, as a device names them. An entry ending in
 * "/" covers every zone under it ("Australia/Perth"). Old aliases are in too
 * ("US/Eastern", "Eire"), since some systems still report them.
 *
 * A better guess than the language: plenty of people in Britain have a
 * browser set to American English, and almost nobody has a clock set to
 * another country's time. It says a country, never a place.
 */
export const TIME_ZONES: Record<Region, string[]> = {
  GB: ['Europe/London', 'Europe/Belfast', 'Europe/Guernsey', 'Europe/Jersey', 'Europe/Isle_of_Man', 'GB', 'GB-Eire'],
  IE: ['Europe/Dublin', 'Eire'],
  US: [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
    'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome',
    'America/Adak', 'America/Boise', 'America/Detroit', 'America/Menominee', 'America/Indiana/', 'America/Kentucky/',
    'America/North_Dakota/', 'America/Indianapolis', 'America/Louisville', 'America/Fort_Wayne', 'Pacific/Honolulu',
    'US/', 'Navajo',
  ],
  CA: [
    'America/Toronto', 'America/Montreal', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Regina',
    'America/Halifax', 'America/St_Johns', 'America/Moncton', 'America/Glace_Bay', 'America/Goose_Bay',
    'America/Whitehorse', 'America/Dawson', 'America/Yellowknife', 'America/Inuvik', 'America/Iqaluit',
    'America/Pangnirtung', 'America/Rankin_Inlet', 'America/Resolute', 'America/Cambridge_Bay', 'America/Swift_Current',
    'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Creston', 'America/Atikokan', 'America/Blanc-Sablon',
    'America/Thunder_Bay', 'America/Nipigon', 'America/Rainy_River', 'Canada/',
  ],
  AU: ['Australia/', 'Antarctica/Macquarie'],
  NZ: ['Pacific/Auckland', 'Pacific/Chatham', 'NZ', 'NZ-CHAT'],
};

/** The country a time zone is in, if it is one of the six; null for anywhere else. */
export function regionFromTimeZone(zone: string | null | undefined): Region | null {
  if (!zone) return null;
  for (const region of Object.keys(TIME_ZONES) as Region[]) {
    if (TIME_ZONES[region].some((entry) => (entry.endsWith('/') ? zone.startsWith(entry) : zone === entry))) return region;
  }
  return null;
}

/** The browser's own guess, where there is a browser. */
export function browserRegion(): Region {
  const nav = (globalThis as { navigator?: { language?: string; languages?: readonly string[] } }).navigator;
  return detectRegion(nav?.languages?.length ? nav.languages : nav?.language);
}

/**
 * The region a profile is in. A profile from before regions existed has none,
 * and belonged to somebody who signed up to a British app: Britain, rather
 * than a guess that could turn their calories into kilojoules overnight.
 */
export function regionOf(profile: { region?: Region }): Region {
  return isRegion(profile.region) ? profile.region : HOME_REGION;
}

/** The energy unit they count in: their own choice, else their region's. */
export function energyUnitOf(profile: { region?: Region; energy?: EnergyUnit }): EnergyUnit {
  return profile.energy === 'kcal' || profile.energy === 'kJ' ? profile.energy : REGIONS[regionOf(profile)].energy;
}

// ---- The current region, for formatters -------------------------------------------------

let current: { region: Region; energy: EnergyUnit } = { region: HOME_REGION, energy: 'kcal' };

/** Called by the store whenever the profile changes. */
export function setCurrentRegion(profile: { region?: Region; energy?: EnergyUnit }): void {
  current = { region: regionOf(profile), energy: energyUnitOf(profile) };
}

export const currentRegion = (): RegionInfo => REGIONS[current.region];
export const currentEnergyUnit = (): EnergyUnit => current.energy;

// ---- Money --------------------------------------------------------------------------------

export function formatPrice(amount: number, region: Region = current.region): string {
  const info = REGIONS[region];
  // Their own language's way of writing it where this is their region; the region's English otherwise.
  const locale = region === current.region ? uiLocale() : info.locale;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: info.currency }).format(amount);
}

/** What a year of Plus comes to each week, for "less than a coffee". */
export function weeklyPrice(region: Region = current.region): string {
  return formatPrice(Math.ceil((REGIONS[region].price.yearly / 52) * 100) / 100, region);
}

// ---- Energy -------------------------------------------------------------------------------

export const KJ_PER_KCAL = 4.184;

/** Energy in their unit, as a number. Stored energy is always kcal. */
export function energyValue(kcal: number, unit: EnergyUnit = current.energy): number {
  return Math.round(unit === 'kJ' ? kcal * KJ_PER_KCAL : kcal);
}

/** "1,850 kcal" or "7,740 kJ". */
export function formatEnergy(kcal: number, unit: EnergyUnit = current.energy, locale = uiLocale()): string {
  return `${energyValue(kcal, unit).toLocaleString(locale)} ${unit}`;
}

/**
 * A round figure for a line of prose — "about 400 kJ" rather than "about
 * 418 kJ", which reads as more precise than any rule of thumb is.
 */
export function aboutEnergy(kcal: number, unit: EnergyUnit = current.energy, locale = uiLocale()): string {
  const value = energyValue(kcal, unit);
  const step = unit === 'kJ' ? (value >= 1000 ? 100 : 50) : 1;
  return `${(Math.round(value / step) * step).toLocaleString(locale)} ${unit}`;
}

/** And back: what somebody typed in their unit, as kcal to store. */
export function toKcal(value: number, unit: EnergyUnit = current.energy): number {
  return Math.round(unit === 'kJ' ? value / KJ_PER_KCAL : value);
}

// ---- Words --------------------------------------------------------------------------------

/**
 * British words, and what each region says instead. Only where the word
 * actually differs: an Australian says biscuit and mince, a Canadian writes
 * fibre.
 */
const WORDS: Record<string, Partial<Record<Region, string>>> = {
  chips: { US: 'fries', CA: 'fries', AU: 'hot chips', NZ: 'hot chips' },
  crisps: { US: 'chips', CA: 'chips', AU: 'chips', NZ: 'chips' },
  biscuit: { US: 'cookie', CA: 'cookie' },
  biscuits: { US: 'cookies', CA: 'cookies' },
  fibre: { US: 'fiber' },
  yoghurt: { US: 'yogurt', CA: 'yogurt' },
  yoghurts: { US: 'yogurts', CA: 'yogurts' },
  prawns: { US: 'shrimp', CA: 'shrimp' },
  mince: { US: 'ground beef', CA: 'ground beef' },
  courgette: { US: 'zucchini', CA: 'zucchini', AU: 'zucchini' },
  courgettes: { US: 'zucchini', CA: 'zucchini', AU: 'zucchini' },
  aubergine: { US: 'eggplant', CA: 'eggplant', AU: 'eggplant', NZ: 'eggplant' },
  coriander: { US: 'cilantro', CA: 'cilantro' },
  sweetcorn: { US: 'corn', CA: 'corn' },
  tinned: { US: 'canned', CA: 'canned' },
  tin: { US: 'can', CA: 'can' },
  tins: { US: 'cans', CA: 'cans' },
  wholemeal: { US: 'whole wheat', CA: 'whole wheat' },
  porridge: { US: 'oatmeal', CA: 'oatmeal' },
  'fizzy drinks': { US: 'sodas', CA: 'pop', AU: 'soft drinks', NZ: 'fizzy drinks' },
  'fizzy drink': { US: 'soda', CA: 'pop', AU: 'soft drink', NZ: 'fizzy drink' },
};

const WORD_PATTERN = new RegExp(
  `\\b(${Object.keys(WORDS)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/ /g, '\\s+'))
    .join('|')})\\b`,
  'gi',
);

const matchCase = (original: string, word: string) =>
  original === original.toUpperCase() && original.length > 1
    ? word.toUpperCase()
    : original[0] === original[0].toUpperCase()
      ? word[0].toUpperCase() + word.slice(1)
      : word;

/**
 * British text in a region's own words, in one pass — so "crisps" becomes
 * "chips" for an American without that "chips" then becoming "fries".
 */
export function localWords(text: string, region: Region = current.region): string {
  // Only English has British words to swap; a translation already uses its own.
  if (region === 'GB' || region === 'IE' || uiLanguage() !== 'en') return text;
  return text.replace(WORD_PATTERN, (found) => {
    const local = WORDS[found.toLowerCase().replace(/\s+/g, ' ')]?.[region];
    return local ? matchCase(found, local) : found;
  });
}

/** "Salt" or "Sodium", as their packets put it. */
export const saltWord = (region: Region = current.region): string =>
  REGIONS[region].salt === 'sodium' ? t('Sodium') : t('Salt');

/** "Fibre", spelt their way, for a label. */
export const fibreWord = (region: Region = current.region): string => (uiLanguage() !== 'en' ? t('Fibre') : region === 'US' ? 'Fiber' : 'Fibre');

// ---- Foods --------------------------------------------------------------------------------

export interface LocalFood {
  name?: string;
  serving?: string;
  servingG?: number;
}

/**
 * The built-in foods under their local names, and in their local sizes where
 * the everyday one differs: an American can of cola is 355 ml, an Australian
 * one 375, and a pint of beer is 568 ml only on one side of the Atlantic.
 */
export const LOCAL_FOODS: Partial<Record<Region, Record<string, LocalFood>>> = {
  US: {
    oats: { name: msg('Rolled oats (oatmeal), dry') },
    'greek-yog': { name: msg('Greek yogurt, 2%') },
    milk: { name: msg('2% milk'), serving: msg('1 cup'), servingG: 240 },
    bread: { name: msg('Whole wheat bread') },
    chips: { name: msg('French fries'), serving: msg('1 medium order'), servingG: 117 },
    'beef-mince': { name: msg('Ground beef, 95% lean'), serving: msg('4 oz'), servingG: 113 },
    tuna: { name: msg('Tuna, canned in water'), serving: msg('1 can'), servingG: 142 },
    prawns: { name: msg('Shrimp, cooked') },
    salad: { name: msg('Mixed salad greens') },
    peas: { name: msg('Green peas') },
    corn: { name: msg('Corn') },
    pizza: { name: msg('Cheese pizza') },
    sandwich: { name: msg('Chicken salad sandwich') },
    'orange-juice': { serving: msg('1 cup'), servingG: 240 },
    cola: { serving: msg('1 can'), servingG: 355 },
    'diet-cola': { serving: msg('1 can'), servingG: 355 },
    beer: { serving: msg('1 bottle'), servingG: 355 },
    wine: { serving: msg('1 glass'), servingG: 150 },
    biscuit: { name: msg('Digestive cookie') },
    crisps: { name: msg('Potato chips'), serving: msg('1 small bag'), servingG: 28 },
  },
  CA: {
    oats: { name: msg('Rolled oats (oatmeal), dry') },
    'greek-yog': { name: msg('Greek yogurt, 2%') },
    milk: { name: msg('2% milk'), serving: msg('1 cup'), servingG: 250 },
    bread: { name: msg('Whole wheat bread') },
    chips: { name: msg('French fries') },
    'beef-mince': { name: msg('Extra-lean ground beef') },
    tuna: { name: msg('Tuna, canned in water'), serving: msg('1 can'), servingG: 120 },
    prawns: { name: msg('Shrimp, cooked') },
    salad: { name: msg('Mixed salad greens') },
    peas: { name: msg('Green peas') },
    corn: { name: msg('Corn') },
    pizza: { name: msg('Cheese pizza') },
    cola: { serving: msg('1 can'), servingG: 355 },
    'diet-cola': { serving: msg('1 can'), servingG: 355 },
    beer: { serving: msg('1 bottle'), servingG: 341 },
    biscuit: { name: msg('Digestive cookie') },
    crisps: { name: msg('Potato chips') },
  },
  AU: {
    oats: { name: msg('Rolled oats, dry') },
    milk: { name: msg('Reduced-fat milk') },
    chips: { name: msg('Hot chips') },
    crisps: { name: msg('Potato chips'), serving: msg('1 small packet'), servingG: 45 },
    'granola-bar': { name: msg('Muesli bar'), serving: msg('1 bar'), servingG: 32 },
    tuna: { name: msg('Tuna in springwater'), serving: msg('1 tin'), servingG: 95 },
    cola: { serving: msg('1 can'), servingG: 375 },
    'diet-cola': { serving: msg('1 can'), servingG: 375 },
    beer: { serving: msg('1 schooner'), servingG: 425 },
    wine: { serving: msg('1 glass'), servingG: 150 },
    corn: { name: msg('Corn kernels') },
    pizza: { name: msg('Margherita pizza') },
  },
  NZ: {
    oats: { name: msg('Rolled oats, dry') },
    milk: { name: msg('Light blue-top milk') },
    chips: { name: msg('Hot chips') },
    crisps: { name: msg('Potato chips'), serving: msg('1 small bag'), servingG: 40 },
    'granola-bar': { name: msg('Muesli bar'), serving: msg('1 bar'), servingG: 30 },
    'sweet-potato': { name: msg('Kūmara, baked') },
    tuna: { name: msg('Tuna in springwater'), serving: msg('1 tin'), servingG: 95 },
    beer: { serving: msg('1 bottle'), servingG: 330 },
    wine: { serving: msg('1 glass'), servingG: 150 },
    corn: { name: msg('Corn kernels') },
    pizza: { name: msg('Margherita pizza') },
  },
};

export function localFood(id: string, region: Region = current.region): LocalFood | undefined {
  return LOCAL_FOODS[region]?.[id];
}
