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
import type { AnalysisResult, FoodItem, MealEntry, MealSlot, Nutrients, Recipe, Targets } from '../types';
import { orderRecipes } from './recipes';
import { addDays } from './date';
import { EMPTY, addNutrients, qualityScore, ultraProcessedShare } from './nutrition';
import { msg, t } from './i18n';

/** The note on a plan the nutritionist made, which is how its meal plan finds them again. */
export const NUTRITIONIST_PLAN_NOTE = msg('Planned by the nutritionist');

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
      const why = left.protein >= 15 && proteinFit >= 0.4 ? t('good for protein') : times >= 3 ? t('a regular') : t('fits your day');
      return { idea: { ...idea, why }, rank };
    })
    .sort((a, b) => b.rank - a.rank || a.idea.title.localeCompare(b.idea.title));

  return ranked.slice(0, count).map((r) => r.idea);
}

/** An idea or a plan, shaped for the review screen. */
export function asAnalysis(meal: Pick<Idea, 'title' | 'items' | 'nutrients' | 'score'>, slot: MealSlot): AnalysisResult {
  return { title: meal.title, items: meal.items, nutrients: meal.nutrients, score: meal.score, coachNote: '', confidence: 'high', slot };
}

/**
 * What they already eat, for the nutritionist to plan around: the meals
 * logged most often in the last month, then saved foods, each once. Titles
 * only — their taste, not their diary.
 */
export function likesFrom(meals: MealEntry[], favourites: FoodItem[], today: string, count = 15, plans: MealEntry[] = [], recipes: Recipe[] = []): string[] {
  // Meals they kept from a plan first, then their saved recipes, the most made
  // first: keeping and saving are the plainest ways of saying "more of this".
  const keptKeys = new Set<string>();
  const kept: string[] = [];
  const add = (raw: string) => {
    const title = raw.trim();
    if (!title || keptKeys.has(title.toLowerCase())) return;
    keptKeys.add(title.toLowerCase());
    kept.push(title);
  };
  for (const plan of plans) if (plan.kept) add(plan.title);
  for (const recipe of orderRecipes(recipes, meals)) add(recipe.title);
  const since = addDays(today, -30);
  const tally = new Map<string, { title: string; times: number }>();
  for (const meal of meals) {
    if (meal.date < since || meal.date > today) continue;
    const key = meal.title.trim().toLowerCase();
    if (!key) continue;
    const known = tally.get(key) ?? { title: meal.title.trim(), times: 0 };
    known.times += 1;
    tally.set(key, known);
  }
  const often = [...tally.values()].sort((a, b) => b.times - a.times || a.title.localeCompare(b.title)).map((t) => t.title);
  const saved = favourites.map((f) => f.name.trim()).filter((name) => name && !tally.has(name.toLowerCase()));
  return [...kept, ...[...often, ...saved].filter((title) => !keptKeys.has(title.toLowerCase()))].slice(0, count);
}

/* ------------------------------------------------------------------ *
 * Keeping a planned meal.
 *
 * A new week from the nutritionist replaces what it planned before on the
 * same days — otherwise Tuesday ends up with two dinners — except the meals
 * somebody kept, and anything they planned themselves. Those stand: the new
 * week leaves their slots alone and plans the rest of the day around them.
 * ------------------------------------------------------------------ */

/** A plan a new week from the nutritionist may replace: its own, and not kept. */
export const replaceable = (plan: MealEntry): boolean => plan.note === NUTRITIONIST_PLAN_NOTE && !plan.kept;

/** The dates a plan of `days` days from `startDate` covers. */
export function weekDates(startDate: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(startDate, i));
}

export interface KeptMeal {
  date: string;
  slot: MealSlot;
  title: string;
  calories: number;
}

/** What a new week on these dates must plan around: every plan there it would not replace. */
export function standingOn(plans: MealEntry[], dates: string[]): KeptMeal[] {
  const on = new Set(dates);
  return plans
    .filter((p) => on.has(p.date) && !replaceable(p))
    .sort((a, b) => a.date.localeCompare(b.date) || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
    .map((p) => ({ date: p.date, slot: p.slot, title: p.title, calories: Math.round(p.nutrients.calories) }));
}

/** The plans a new week on these dates takes the place of. */
export function replacedOn(plans: MealEntry[], dates: string[]): MealEntry[] {
  const on = new Set(dates);
  return plans.filter((p) => on.has(p.date) && replaceable(p));
}

/* ------------------------------------------------------------------ *
 * Cooking for more than one.
 *
 * A plan's ingredients are one portion, sized to one person's day, and that
 * portion is what gets logged. Cooking for a household multiplies the recipe
 * and the shopping, never the diary. Usually it is dinner that is shared and
 * the rest of the day is one's own, so that is the default; a meal can say
 * otherwise for itself (lunch for the children too, a dinner out alone).
 * ------------------------------------------------------------------ */

export const MAX_SERVINGS = 8;

export interface Household {
  /** Everybody eating, them included. */
  people: number;
  /** Which meals everybody shares: just dinner, or every meal. */
  shared: 'dinner' | 'all';
}

export const SOLO: Household = { people: 1, shared: 'dinner' };

/** A household as saved or sent, made sensible. */
export function cleanHousehold(raw: Partial<Household> | undefined): Household {
  const people = Math.round(Number(raw?.people));
  return {
    people: Number.isFinite(people) ? Math.min(MAX_SERVINGS, Math.max(1, people)) : 1,
    shared: raw?.shared === 'all' ? 'all' : 'dinner',
  };
}

/** How many a planned meal is cooked for: its own number, else the household's for that meal. */
export function servingsFor(plan: Pick<MealEntry, 'slot' | 'servings'>, household: Household = SOLO): number {
  if (plan.servings) return plan.servings;
  const { people, shared } = cleanHousehold(household);
  return shared === 'all' || plan.slot === 'dinner' ? people : 1;
}
