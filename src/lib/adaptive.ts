/**
 * Learning what someone actually burns, instead of assuming.
 *
 * Mifflin-St Jeor is a population average, and real metabolisms sit anywhere
 * from about 15% under it to 15% over. Given enough logged days and enough
 * weigh-ins, the truth is recoverable from energy balance: whatever you ate,
 * plus whatever came off you, is what you burned.
 *
 *     burn = mean intake − (weight change in kg × 7700) / days
 *
 * The arithmetic is the easy part. The hard part is that this method has one
 * catastrophic failure mode, and it is the common case: people under-report
 * what they eat, often by a fifth or more. Believe the raw numbers from an
 * under-logger and you conclude their metabolism is broken, cut their target,
 * and make things worse. Every guard in this file exists because of that.
 */
import type { DayLog, MealEntry, Profile } from '../types';
import { baseTdee, bmr } from './nutrition';
import { isoDate } from './date';

/** The usual approximation for a kilogram of body tissue. */
export const KCAL_PER_KG = 7700;

/** Nothing is inferred from less than this. Below it, noise swamps signal. */
export const MIN_DAYS_LOGGED = 10;
export const MIN_WEIGH_INS = 4;
export const MIN_SPAN_DAYS = 14;

/**
 * How far the estimate may move the formula — and it may not move as far down
 * as up. The two directions are not equally likely to be true: people
 * under-report what they eat far more often than they over-report it, so a
 * reading that says "you burn less than the textbook thinks" is more often a
 * diary with gaps than a slow metabolism. Upward, the same reading is usually
 * honest. So the benefit of the doubt goes towards feeding people.
 */
export const MAX_SHIFT_UP = 0.15;
export const MAX_SHIFT_DOWN = 0.1;

/** Worth mentioning only if it would actually change the numbers. */
const WORTH_SAYING = 0.03;

export interface Observation {
  /** Days complete enough to count towards the average. */
  loggedDays: number;
  weighIns: number;
  /** Days from the first weigh-in to the last. */
  spanDays: number;
  meanIntake: number;
  /** Trend through the weigh-ins, not first-minus-last: scales lie daily. */
  weeklyChangeKg: number;
  /** What energy balance says they burn, before any guard is applied. */
  burn: number;
  /** 0–1, how much of the above to believe. */
  confidence: number;
}

export interface Adjustment {
  /** What the textbook formula says. */
  formula: number;
  /** What their own logs say, unguarded. */
  observed: number;
  /** What we would actually use: blended, capped, and never below basal. */
  applied: number;
  /** `applied / formula`, which is what gets stored on the profile. */
  factor: number;
  /** True when the cap bit — usually a sign of gaps in the logging. */
  capped: boolean;
  observation: Observation;
}

/** Least-squares slope through the weigh-ins, in kg per day. */
function trendPerDay(points: { day: number; kg: number }[]): number {
  const n = points.length;
  const meanDay = points.reduce((sum, p) => sum + p.day, 0) / n;
  const meanKg = points.reduce((sum, p) => sum + p.kg, 0) / n;
  let top = 0;
  let bottom = 0;
  for (const p of points) {
    top += (p.day - meanDay) * (p.kg - meanKg);
    bottom += (p.day - meanDay) ** 2;
  }
  return bottom === 0 ? 0 : top / bottom;
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * What the last `window` days say about this person's burn rate.
 *
 * Returns null when there is not enough to go on, which is the honest answer
 * far more often than not.
 */
export function observe(
  meals: MealEntry[],
  days: Record<string, DayLog>,
  targetCalories: number,
  window = 28,
  today = isoDate(),
): Observation | null {
  const end = dayNumber(today);
  const start = end - window + 1;
  const inWindow = (iso: string) => {
    const n = dayNumber(iso);
    return n >= start && n <= end;
  };

  const eatenPerDay = new Map<string, number>();
  for (const meal of meals) {
    if (!inWindow(meal.date)) continue;
    eatenPerDay.set(meal.date, (eatenPerDay.get(meal.date) ?? 0) + meal.nutrients.calories);
  }

  /*
   * A day only counts if it looks like a whole day's eating. Half-logged days
   * drag the average down, and a dragged-down average reads as a slow
   * metabolism — the exact wrong conclusion. Excluding them biases the
   * estimate upwards, which is the safe direction to be wrong in: it errs
   * towards feeding someone rather than starving them.
   */
  const floor = Math.max(800, targetCalories * 0.5);
  const counted = [...eatenPerDay.values()].filter((kcal) => kcal >= floor);
  if (counted.length < MIN_DAYS_LOGGED) return null;

  const weighIns = Object.values(days)
    .filter((day) => day.weightKg && inWindow(day.date))
    .map((day) => ({ day: dayNumber(day.date), kg: day.weightKg as number }))
    .sort((a, b) => a.day - b.day);

  if (weighIns.length < MIN_WEIGH_INS) return null;

  const spanDays = weighIns[weighIns.length - 1].day - weighIns[0].day;
  if (spanDays < MIN_SPAN_DAYS) return null;

  const meanIntake = counted.reduce((sum, kcal) => sum + kcal, 0) / counted.length;
  const perDay = trendPerDay(weighIns);
  const burn = meanIntake - perDay * KCAL_PER_KG;

  // Both inputs earn belief separately: plenty of weigh-ins cannot rescue a
  // sparse food diary, and vice versa.
  const confidence = Math.min(1, (counted.length / 21) * 0.6 + (weighIns.length / 8) * 0.4);

  return {
    loggedDays: counted.length,
    weighIns: weighIns.length,
    spanDays,
    meanIntake: Math.round(meanIntake),
    weeklyChangeKg: Math.round(perDay * 7 * 100) / 100,
    burn: Math.round(burn),
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Turn an observation into an adjustment worth offering, or nothing.
 *
 * The formula is not thrown away — the observation is blended into it in
 * proportion to how much data backs it up, then capped, then floored at basal
 * rate. Nobody's maintenance is below what their body burns lying still.
 */
export function suggest(profile: Profile, observation: Observation | null): Adjustment | null {
  if (!observation) return null;

  // Always measured against the untouched formula, so repeat suggestions
  // converge on the truth rather than compounding on each other.
  const formula = baseTdee(profile);
  const blended = formula + (observation.burn - formula) * observation.confidence;

  const lowest = Math.max(formula * (1 - MAX_SHIFT_DOWN), bmr(profile));
  const highest = formula * (1 + MAX_SHIFT_UP);
  const applied = Math.round(Math.min(highest, Math.max(lowest, blended)));
  const capped = blended < lowest || blended > highest;

  const factor = Math.round((applied / formula) * 1000) / 1000;

  // Nothing to offer if this is already what they are on — otherwise the card
  // sits there recommending the change they just made.
  if (Math.abs(factor - (profile.burnFactor ?? 1)) < WORTH_SAYING) return null;

  return {
    formula: Math.round(formula),
    observed: observation.burn,
    applied,
    factor,
    capped,
    observation,
  };
}

/** The whole job: look at the logs, decide whether there is anything to say. */
export function adaptiveSuggestion(
  profile: Profile,
  meals: MealEntry[],
  days: Record<string, DayLog>,
  targetCalories: number,
  today = isoDate(),
): Adjustment | null {
  return suggest(profile, observe(meals, days, targetCalories, 28, today));
}
