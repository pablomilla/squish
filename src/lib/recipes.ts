/**
 * The recipe box: meals kept to make again.
 *
 * A recipe is one portion, exactly as it is logged — the same shape as a
 * planned meal, so planning it, cooking it and logging it are the things the
 * app already does with plans. Nothing here counts: how often a recipe has
 * been made is read from the diary, by name, so it cannot drift from what was
 * actually eaten, and a meal logged some other way still counts.
 */
import type { CookSteps, FoodItem, MealEntry, MealSlot, Nutrients, Recipe } from '../types';

const key = (title: string) => title.trim().toLocaleLowerCase();

/** A meal, planned or eaten or imported, as a recipe to keep. */
export function recipeFrom(
  meal: { title: string; slot?: MealSlot; items: FoodItem[]; nutrients: Nutrients; score: number; cook?: CookSteps },
  today: string,
  sourceUrl?: string,
): Omit<Recipe, 'id'> {
  return {
    title: meal.title.trim(),
    slot: meal.slot ?? 'dinner',
    items: meal.items,
    nutrients: meal.nutrients,
    score: meal.score,
    ...(meal.cook ? { cook: meal.cook } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    savedAt: today,
  };
}

/** The saved recipe with this name, if there is one. Names are how a meal is known again. */
export function findRecipe(recipes: Recipe[], title: string): Recipe | undefined {
  const k = key(title);
  return k ? recipes.find((r) => key(r.title) === k) : undefined;
}

/** How often it has been made, and when last: meals in the diary with its name. */
export function madeOf(recipe: Pick<Recipe, 'title'>, meals: MealEntry[]): { times: number; last?: string } {
  const k = key(recipe.title);
  let times = 0;
  let last: string | undefined;
  for (const meal of meals) {
    if (key(meal.title) !== k) continue;
    times += 1;
    if (!last || meal.date > last) last = meal.date;
  }
  return { times, last };
}

/** The box in the order it is used: the most made first, then the newest saved. */
export function orderRecipes(recipes: Recipe[], meals: MealEntry[]): Recipe[] {
  const times = new Map(recipes.map((r) => [r.id, madeOf(r, meals).times]));
  return [...recipes].sort((a, b) => times.get(b.id)! - times.get(a.id)! || b.savedAt.localeCompare(a.savedAt) || a.title.localeCompare(b.title));
}

/** Recipes whose name or ingredients mention every word asked for. */
export function searchRecipes(recipes: Recipe[], query: string): Recipe[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return recipes;
  return recipes.filter((r) => {
    const text = [r.title, ...r.items.map((i) => i.name)].join(' ').toLocaleLowerCase();
    return words.every((w) => text.includes(w));
  });
}
