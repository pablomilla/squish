/**
 * Unit conversion.
 *
 * Everything is stored in metric — centimetres and kilograms — and converted
 * only for display, so switching units never changes what was recorded.
 * Imperial is feet and inches everywhere, but a body weight is stones and
 * pounds only in Britain and Ireland; elsewhere it is plain pounds (see
 * lib/region.ts).
 */
import { round1 } from './nutrition';
import { currentRegion } from './region';
import { t, uiLocale } from './i18n';

/** One decimal place, written the way their language writes one: 71.7, 71,7. */
const num = (n: number) => round1(n).toLocaleString(uiLocale());

/**
 * Stored weights keep two decimal places of a kilogram.
 *
 * One was not enough: 0.1 kg is 0.22 lb, coarser than the 0.1 lb the
 * stones-and-pounds field accepts, so typing "10 st 10 lb" stored 68.0 kg and
 * read back as 10 st 9.9 lb. Every whole pound came back wrong.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

export const CM_PER_INCH = 2.54;
export const GRAMS_PER_OUNCE = 28.349523125;
/**
 * Salt is sodium chloride, so a gram of salt is only about 0.4 g of sodium.
 * Nutrition is stored as sodium in milligrams, the way databases hold it, but
 * every packet in a British shop states salt in grams and the NHS guideline is
 * 6 g of salt a day — so that is what gets shown.
 */
export const SALT_PER_SODIUM = 2.5;
/** The imperial fluid ounce. The US one is 29.57 ml; this app speaks British. */
export const ML_PER_FLUID_OUNCE = 28.4130625;
export const INCHES_PER_FOOT = 12;
export const KG_PER_POUND = 0.45359237;
export const POUNDS_PER_STONE = 14;
/** The largest pounds value that can sit inside a stone, at one decimal place. */
export const MAX_POUNDS_IN_STONE = 13.9;

export interface FeetInches {
  feet: number;
  inches: number;
}

export interface StonePounds {
  stone: number;
  pounds: number;
}

export function cmToFeetInches(cm: number): FeetInches {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return {
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return Math.round((feet * INCHES_PER_FOOT + inches) * CM_PER_INCH);
}

export function kgToStonePounds(kg: number): StonePounds {
  const totalPounds = kg / KG_PER_POUND;
  const stone = Math.floor(totalPounds / POUNDS_PER_STONE);
  const pounds = Math.round((totalPounds - stone * POUNDS_PER_STONE) * 10) / 10;
  // Rounding can push pounds up to a whole stone — carry it rather than show "9 st 14 lb".
  if (pounds >= POUNDS_PER_STONE) return { stone: stone + 1, pounds: 0 };
  return { stone, pounds };
}

export function stonePoundsToKg(stone: number, pounds: number): number {
  return round2((stone * POUNDS_PER_STONE + pounds) * KG_PER_POUND);
}

export function kgToPounds(kg: number): number {
  return Math.round(kg / KG_PER_POUND);
}

export function poundsToKg(pounds: number): number {
  return round2(pounds * KG_PER_POUND);
}

/**
 * What a portion weighed, in grams with ounces beside it.
 *
 * Both, always, rather than following the profile's units: that toggle is
 * about bodies, and food is labelled in grams here and sold in ounces
 * elsewhere. A portion is an estimate either way, so the ounces are rounded
 * to match — no one needs 11.29 oz of stew.
 */
/** Sodium in milligrams, said as the salt figure people read on a packet. */
export function saltGrams(sodiumMg: number): number {
  return Math.round(((sodiumMg * SALT_PER_SODIUM) / 1000) * 10) / 10;
}

/** And back again, for a limit someone sets in grams of salt. */
export function sodiumMg(salt: number): number {
  return Math.round((salt * 1000) / SALT_PER_SODIUM);
}

/**
 * Salt as their packets say it: grams of salt in Britain and Ireland,
 * milligrams of sodium everywhere else. Stored as sodium throughout.
 */
export const showsSodium = () => currentRegion().salt === 'sodium';
export const saltLabel = () => (showsSodium() ? t('Sodium') : t('Salt'));
export const saltUnit = () => (showsSodium() ? 'mg' : 'g');
/** The number to show for this much sodium: salt grams to one place, or sodium to the nearest 10 mg. */
export const saltShown = (sodium: number) => (showsSodium() ? Math.round(sodium / 10) * 10 : saltGrams(sodium));
/** The same, from a figure already in grams of salt. */
export const saltShownFromSalt = (salt: number) => (showsSodium() ? Math.round((salt * 1000) / SALT_PER_SODIUM / 10) * 10 : salt);
export const formatSalt = (sodium: number) => `${saltShown(sodium).toLocaleString(uiLocale())} ${saltUnit()}`;
/** A limit typed in the shown unit, back to stored sodium. */
export const sodiumFromShown = (value: number) => (showsSodium() ? Math.round(value) : sodiumMg(value));

export function formatFoodWeight(grams: number): string {
  const ounces = grams / GRAMS_PER_OUNCE;
  const shown = ounces < 10 ? Math.round(ounces * 10) / 10 : Math.round(ounces);
  return `${Math.round(grams).toLocaleString(uiLocale())} g (${shown.toLocaleString(uiLocale())} oz)`;
}

/**
 * What a drink measured, in millilitres with fluid ounces beside it. Drinks
 * are stored as grams like everything else, which for anything water-based is
 * near enough the same number.
 */
export function formatDrinkVolume(ml: number): string {
  const ounces = ml / currentRegion().fluidOunceMl;
  const shown = ounces < 10 ? Math.round(ounces * 10) / 10 : Math.round(ounces);
  return `${Math.round(ml).toLocaleString(uiLocale())} ml (${shown.toLocaleString(uiLocale())} fl oz)`;
}

/** A weight the description already carries, so it is not said twice. */
const WEIGHT_IN_BRACKETS = /\s*\((?:about\s*)?\d+(?:\.\d+)?\s*(?:g|grams?|ml)\)\s*$/i;
const NOTHING_BUT_A_WEIGHT = /^\s*\d+(?:\.\d+)?\s*(?:g|grams?|ml)\s*$/i;

/**
 * A portion as the app shows it: what it was, then what it weighed.
 *
 * The words and the weight are kept apart so the weight can be converted, and
 * so that scaling a portion changes it — "2 × 1 bowl (320 g)" used to go on
 * saying 320 g however many bowls you had.
 */
export function describePortion(portion: string, grams?: number, liquid = false): string {
  if (!grams) return portion; // A quick-added entry has no weight to show.
  const words = portion.replace(WEIGHT_IN_BRACKETS, '').replace(NOTHING_BUT_A_WEIGHT, '').trim();
  const measure = liquid ? formatDrinkVolume(grams) : formatFoodWeight(grams);
  return words ? `${words} · ${measure}` : measure;
}

export type Units = 'metric' | 'imperial';

export function formatHeight(cm: number, units: Units): string {
  if (units === 'metric') return `${Math.round(cm)} cm`;
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet}′ ${inches}″`;
}

/** Whether an imperial weight is plain pounds where they live, rather than stones. */
export const inPounds = () => currentRegion().weight === 'pounds';

export function formatWeight(kg: number, units: Units): string {
  if (units === 'metric') return `${num(kg)} kg`;
  if (inPounds()) return `${num(kg / KG_PER_POUND)} lb`;
  const { stone, pounds } = kgToStonePounds(kg);
  return pounds ? `${stone} st ${num(pounds)} lb` : `${stone} st`;
}

/** A weight difference — always signed, so "lost 2 kg" reads as -2. */
export function formatWeightDelta(kgDelta: number, units: Units): string {
  const sign = kgDelta > 0 ? '+' : '';
  if (units === 'metric') return `${sign}${num(kgDelta)} kg`;
  return `${sign}${num(kgDelta / KG_PER_POUND)} lb`;
}

export const weightUnitLabel = (units: Units) => (units === 'metric' ? 'kg' : 'lb');

/** The Units switch's imperial side: "ft / st" in Britain, "ft / lb" elsewhere. */
export const imperialLabel = () => (inPounds() ? 'ft / lb' : 'ft / st');

/**
 * What the entry fields will accept, chosen so both systems span the same
 * range. When they disagreed, a value you could type in one was silently
 * clamped the moment you switched to the other: 5 st went in happily and came
 * back as 35 kg.
 *
 * The stone maximum is 38 rather than 39 because the pounds field sits beside
 * it and can add almost another stone on top.
 */
export const WEIGHT_KG_RANGE = { min: 31, max: 250 };
export const STONE_RANGE = { min: 5, max: 38 };
/** The kilogram range again, in whole pounds. */
export const POUNDS_RANGE = { min: 68, max: 551 };
export const HEIGHT_CM_RANGE = { min: 122, max: 241 };
export const FEET_RANGE = { min: 4, max: 7 };

/**
 * Where setup starts people, round in whichever system they are reading.
 * 68 kg is a tidy number to be shown; the very same weight in stones is
 * 10 st 9.9 lb, which is not.
 */
export const STARTING_WEIGHTS: Record<Units, { weightKg: number; targetWeightKg: number }> = {
  metric: { weightKg: 68, targetWeightKg: 63 },
  imperial: { weightKg: stonePoundsToKg(10, 10), targetWeightKg: stonePoundsToKg(10, 0) },
};

/**
 * Weekly pace is stored in kilograms, but nobody losing weight in stones
 * thinks in kilograms. Each system offers its own choices, a quarter of a
 * pound at a time rather than a tenth of a kilo.
 */
export const PACE_CHOICES: Record<Units, { min: number; max: number; step: number }> = {
  metric: { min: 0.1, max: 1, step: 0.1 },
  imperial: { min: 0.25, max: 2, step: 0.25 },
};

/** A stored kg pace expressed in the displayed unit, on that unit's grid. */
export function paceIn(kgPerWeek: number, units: Units): number {
  const { min, max, step } = PACE_CHOICES[units];
  const raw = units === 'metric' ? kgPerWeek : kgPerWeek / KG_PER_POUND;
  return Math.min(max, Math.max(min, round2(Math.round(raw / step) * step)));
}

/** The reverse: what the slider hands back, stored as kilograms. */
export function paceToKg(value: number, units: Units): number {
  return units === 'metric' ? round2(value) : round2(value * KG_PER_POUND);
}

export function formatPace(kgPerWeek: number, units: Units): string {
  return `${paceIn(kgPerWeek, units).toLocaleString(uiLocale())} ${weightUnitLabel(units)}`;
}

const isStartingWeight = (kg: number, which: 'weightKg' | 'targetWeightKg') =>
  Object.values(STARTING_WEIGHTS).some((start) => start[which] === kg);

/**
 * Re-express a profile when someone switches systems.
 *
 * A weight they have actually typed is theirs, and is converted rather than
 * altered. A starting value they have never touched is replaced with the one
 * that reads well in the system they have just chosen.
 */
export function retuneForUnits<T extends { units: Units; weightKg: number; targetWeightKg: number; pace: number }>(
  profile: T,
  units: Units,
): T {
  return {
    ...profile,
    units,
    weightKg: isStartingWeight(profile.weightKg, 'weightKg') ? STARTING_WEIGHTS[units].weightKg : profile.weightKg,
    targetWeightKg: isStartingWeight(profile.targetWeightKg, 'targetWeightKg')
      ? STARTING_WEIGHTS[units].targetWeightKg
      : profile.targetWeightKg,
    pace: paceToKg(paceIn(profile.pace, units), units),
  };
}
