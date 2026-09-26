/**
 * Planning ahead, the light way.
 *
 * Not a weekly meal plan to fill in: those take effort up front, go stale
 * by Wednesday, and in a food app sit close to "eat exactly this", which is
 * a diet rather than a diary. Two smaller things instead:
 *
 * - A meal can be planned for later today or the week ahead, from any of the
 *   usual ways in. It waits apart from the diary (the store's `plans`) and
 *   counts for nothing until somebody says they ate it.
 * - "Ideas for the rest of today": a few of their own meals and favourites
 *   that fit what is left of the day. Their food, not an invented menu, and
 *   no AI call.
 *
 * What it never does: suggest eating less than the target, or anything when
 * the day is nearly done. A plan not followed is not a failure, so nothing
 * here keeps score of plans.
 */
import type { AnalysisResult, FoodItem, MealEntry, MealSlot, Nutrients, Targets } from '../types';
import { addDays } from './date';
import { EMPTY, addNutrients, qualityScore, ultraProcessedShare } from './nutrition';

/** How far ahead the diary lets somebody plan. A week is as far as most people plan food. */
export const PLAN_DAYS_AHEAD = 7;

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function plansOn(plans: MealEntry[], date: string): MealEntry[] {
  return plans.filter((p) => p.date === date).sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
}

/** The days a plan can be for: today and the week after. */
export function planDays(today: string): string[] {
  return Array.from({ length: PLAN_DAYS_AHEAD + 1 }, (_, i) => addDays(today, i));
}

export interface Remaining {
  calories: number;
  protein: number;
}

/** What is left of today's calories and protein, never below nought. */
export function remainingToday(meals: MealEntry[], targets: Targets, today: string): Remaining {
  const eaten = meals.filter((m) => m.date === today).reduce((acc, m) => addNutrients(acc, m.nutrients), { ...EMPTY });
  return {
    calories: Math.max(0, Math.round(targets.calories - eaten.calories)),
    protein: Math.max(0, Math.round(targets.protein - eaten.protein)),
  };
}

export interface Idea {
  key: string;
  title: string;
  items: FoodItem[];
  nutrients: Nutrients;
  score: number;
  from: 'recent' | 'saved';
  /** Why it is here, in a few words: "fits your day", "good for protein". */
  why: string;
}

/** Below this much left, there is no "rest of the day" worth suggesting for. */
export const IDEAS_MIN_KCAL = 200;

/**
 * Up to `count` of their own meals and saved foods that fit what is left.
 *
 * "Fits" means no more than a tenth over the calories left — and nothing
 * tiny, so a biscuit is never offered as the answer to 700 kcal. Among those,
 * the ones that close the protein gap and score well come first, with a nudge
 * for things they eat often. Nothing already eaten today, and nothing twice.
 */
export function ideasFor(
  meals: MealEntry[],
  favourites: FoodItem[],
  targets: Targets,
  today: string,
  count = 3,
): Idea[] {
  const left = remainingToday(meals, targets, today);
  if (left.calories < IDEAS_MIN_KCAL) return [];

  const since = addDays(today, -60);
  const eatenToday = new Set(meals.filter((m) => m.date === today).map((m) => m.title.trim().toLowerCase()));
  const seen = new Map<string, { idea: Idea; times: number }>();

  for (const meal of meals) {
    if (meal.date >= today || meal.date < since) continue;
    const key = meal.title.trim().toLowerCase();
    if (!key || eatenToday.has(key)) continue;
    const known = seen.get(key);
    if (known) {
      known.times += 1;
      continue;
    }
    seen.set(key, {
      times: 1,
      idea: { key, title: meal.title, items: meal.items, nutrients: meal.nutrients, score: meal.score, from: 'recent', why: '' },
    });
  }
  for (const food of favourites) {
    const key = food.name.trim().toLowerCase();
    if (!key || eatenToday.has(key) || seen.has(key)) continue;
    const score = qualityScore(food.nutrients, ultraProcessedShare([food]));
    seen.set(key, { times: 1, idea: { key, title: food.name, items: [food], nutrients: food.nutrients, score, from: 'saved', why: '' } });
  }

  const floor = Math.min(250, left.calories * 0.3);
  const ranked = [...seen.values()]
    .filter(({ idea }) => idea.nutrients.calories >= floor && idea.nutrients.calories <= left.calories * 1.1)
    .map(({ idea, times }) => {
      const proteinFit = left.protein > 0 ? Math.min(1, idea.nutrients.protein / left.protein) : 0;
      const rank = proteinFit * 2 + idea.score / 100 + Math.min(times, 5) * 0.1;
      const why = left.protein >= 15 && proteinFit >= 0.4 ? 'good for protein' : times >= 3 ? 'a regular' : 'fits your day';
      return { idea: { ...idea, why }, rank };
    })
    .sort((a, b) => b.rank - a.rank || a.idea.title.localeCompare(b.idea.title));

  return ranked.slice(0, count).map((r) => r.idea);
}

/** An idea or a plan, shaped for the review screen. */
export function asAnalysis(meal: Pick<Idea, 'title' | 'items' | 'nutrients' | 'score'>, slot: MealSlot): AnalysisResult {
  return { title: meal.title, items: meal.items, nutrients: meal.nutrients, score: meal.score, coachNote: '', confidence: 'high', slot };
}
