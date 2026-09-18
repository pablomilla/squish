/**
 * Unit conversion.
 *
 * Everything is stored in metric — centimetres and kilograms — and converted
 * only for display, so switching units never changes what was recorded.
 * Imperial here is the British reading: feet and inches, stones and pounds.
 */
import { round1 } from './nutrition';

/**
 * Stored weights keep two decimal places of a kilogram.
 *
 * One was not enough: 0.1 kg is 0.22 lb, coarser than the 0.1 lb the
 * stones-and-pounds field accepts, so typing "10 st 10 lb" stored 68.0 kg and
 * read back as 10 st 9.9 lb. Every whole pound came back wrong.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

export const CM_PER_INCH = 2.54;
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

export type Units = 'metric' | 'imperial';

export function formatHeight(cm: number, units: Units): string {
  if (units === 'metric') return `${Math.round(cm)} cm`;
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet}′ ${inches}″`;
}

export function formatWeight(kg: number, units: Units): string {
  if (units === 'metric') return `${round1(kg)} kg`;
  const { stone, pounds } = kgToStonePounds(kg);
  return pounds ? `${stone} st ${round1(pounds)} lb` : `${stone} st`;
}

/** A weight difference — always signed, so "lost 2 kg" reads as -2. */
export function formatWeightDelta(kgDelta: number, units: Units): string {
  const sign = kgDelta > 0 ? '+' : '';
  if (units === 'metric') return `${sign}${round1(kgDelta)} kg`;
  return `${sign}${round1(kgDelta / KG_PER_POUND)} lb`;
}

export const weightUnitLabel = (units: Units) => (units === 'metric' ? 'kg' : 'lb');

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
  return `${paceIn(kgPerWeek, units)} ${weightUnitLabel(units)}`;
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
