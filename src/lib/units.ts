/**
 * Unit conversion.
 *
 * Everything is stored in metric — centimetres and kilograms — and converted
 * only for display, so switching units never changes what was recorded.
 * Imperial here is the British reading: feet and inches, stones and pounds.
 */
import { round1 } from './nutrition';

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
  return round1((stone * POUNDS_PER_STONE + pounds) * KG_PER_POUND);
}

export function kgToPounds(kg: number): number {
  return Math.round(kg / KG_PER_POUND);
}

export function poundsToKg(pounds: number): number {
  return round1(pounds * KG_PER_POUND);
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
