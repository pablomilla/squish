/**
 * Learning from how the plans went.
 *
 * Squish sees what a meal planner cannot: which planned meals were actually
 * made, and which were skipped, swapped or dropped. Kept here as a short log
 * of what happened to each of the nutritionist's meals, that is what the next
 * plan is told — more like what they made, fewer like what they didn't, never
 * anything they have said is not for them — and what the weekly check-in shows
 * them, so the learning is theirs to see and to correct.
 *
 * Only the nutritionist's meals are judged. A meal somebody planned for
 * themselves says nothing about the nutritionist's choices, and a plan not
 * followed is not a failure: nothing here keeps score of the person, only of
 * the meals.
 */
import type { MealEntry, MealSlot } from '../types';
import { addDays } from './date';
import { isSquishPlan } from './planner';

export type Outcome = 'made' | 'skipped' | 'swapped' | 'dropped';

export interface PlanOutcome {
  title: string;
  slot: MealSlot;
  /** The day it was planned for. */
  date: string;
  outcome: Outcome;
}

/** How much history is kept: two months of plans is plenty to learn from. */
export const LOG_MAX = 200;
/** A plan is skipped once this many days have passed without it being eaten: yesterday's dinner may still be logged late. */
export const SKIP_AFTER_DAYS = 2;
/** What the check-in and the next plan look back over. */
export const LOOK_BACK_DAYS = 28;

const key = (title: string) => title.trim().toLocaleLowerCase();

export const judged = (plan: Pick<MealEntry, 'note'>): boolean => isSquishPlan(plan);

/** A plan's outcome, for the log. */
export const outcomeOf = (plan: Pick<MealEntry, 'title' | 'slot' | 'date'>, outcome: Outcome): PlanOutcome => ({
  title: plan.title.trim(),
  slot: plan.slot,
  date: plan.date,
  outcome,
});

/**
 * Take back outcomes just logged — "dropped" undone puts the meals back as if
 * nothing had happened. The newest matching entry goes for each, once.
 */
export function unlogged(log: PlanOutcome[], ...taken: PlanOutcome[]): PlanOutcome[] {
  const out = [...log];
  for (const o of taken) {
    for (let i = out.length - 1; i >= 0; i--) {
      const e = out[i];
      if (e.title === o.title && e.slot === o.slot && e.date === o.date && e.outcome === o.outcome) {
        out.splice(i, 1);
        break;
      }
    }
  }
  return out;
}

/** Add to the log, newest last, keeping it to its length. */
export function logged(log: PlanOutcome[], ...more: PlanOutcome[]): PlanOutcome[] {
  return [...log, ...more].slice(-LOG_MAX);
}

/**
 * Plans whose day has gone by without their being eaten: the nutritionist's
 * are skipped, and every such plan leaves the diary, where a dashed dinner
 * from last Tuesday is only clutter.
 */
export function stalePlans(plans: MealEntry[], today: string): { stale: MealEntry[]; skipped: PlanOutcome[] } {
  const before = addDays(today, -SKIP_AFTER_DAYS);
  const stale = plans.filter((p) => p.date <= before);
  return { stale, skipped: stale.filter(judged).map((p) => outcomeOf(p, 'skipped')) };
}

export interface PlanReview {
  /** Meals the nutritionist planned in the window, with an outcome. */
  planned: number;
  made: number;
  /** Made, the most often first. */
  hits: { title: string; times: number }[];
  /** Skipped, swapped or dropped and never made, the most often first. */
  misses: { title: string; times: number; outcome: Outcome }[];
}

/** How the plans in the window went. */
export function reviewOf(log: PlanOutcome[], from: string, to: string): PlanReview {
  const within = log.filter((o) => o.date >= from && o.date <= to);
  const made = new Map<string, { title: string; times: number }>();
  const missed = new Map<string, { title: string; times: number; outcome: Outcome }>();
  for (const o of within) {
    const k = key(o.title);
    if (!k) continue;
    if (o.outcome === 'made') {
      const m = made.get(k) ?? { title: o.title, times: 0 };
      m.times += 1;
      made.set(k, m);
    } else {
      const m = missed.get(k) ?? { title: o.title, times: 0, outcome: o.outcome };
      m.times += 1;
      m.outcome = o.outcome;
      missed.set(k, m);
    }
  }
  const byTimes = <T extends { times: number; title: string }>(a: T, b: T) => b.times - a.times || a.title.localeCompare(b.title);
  return {
    planned: within.length,
    made: within.filter((o) => o.outcome === 'made').length,
    hits: [...made.values()].sort(byTimes),
    // Made once and skipped once is still a meal they make.
    misses: [...missed.entries()].filter(([k]) => !made.has(k)).map(([, m]) => m).sort(byTimes),
  };
}

export interface PlanHistory {
  planned: number;
  made: number;
  hits: string[];
  misses: string[];
  /** Said not to be for them: never planned again. */
  never: string[];
}

/** What the next plan is told about how the last ones went; nothing when there is nothing to go on. */
export function historyFor(log: PlanOutcome[], notForMe: string[], today: string): PlanHistory | undefined {
  const review = reviewOf(log, addDays(today, -LOOK_BACK_DAYS), today);
  const never = notForMe.slice(-20);
  if (review.planned < 3 && !never.length) return undefined;
  const nevers = new Set(never.map(key));
  return {
    planned: review.planned,
    made: review.made,
    hits: review.hits.slice(0, 10).map((h) => h.title),
    misses: review.misses.filter((m) => !nevers.has(key(m.title))).slice(0, 10).map((m) => m.title),
    never,
  };
}

/** Add or take away a title from the not-for-me list, by name. */
export function toggleNever(list: string[], title: string): string[] {
  const k = key(title);
  return list.some((t) => key(t) === k) ? list.filter((t) => key(t) !== k) : [...list, title.trim()].slice(-40);
}

export const isNever = (list: string[], title: string): boolean => list.some((t) => key(t) === key(title));

/** The check-in looks at the last seven days, today included. */
export function lastWeekReview(log: PlanOutcome[], today: string): PlanReview {
  return reviewOf(log, addDays(today, -6), today);
}

/** Shown once a week, and only when there is enough to say something: three of the nutritionist's meals with an outcome. */
export function checkInDue(review: PlanReview, seenWeek: string, thisWeek: string): boolean {
  return review.planned >= 3 && seenWeek !== thisWeek;
}
