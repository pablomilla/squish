/**
 * Grounding an analysis in the food table: for each plain food the AI named
 * in a table's words, the nutrition per gram is the table's, scaled to the
 * AI's portion. See server/foodTable.ts for the table and server/foodMatch.ts
 * for when a match is trusted — cautiously, and never at the cost of a
 * reading: anything unmatched, or any failure here, leaves the AI's figures
 * exactly as they were.
 */
import type { ModelMeal } from './claude';
import { tableFoods, type Per100, type TableFood } from './foodTable';
import { candidates, indexFoods, plausible, type FoodIndex } from './foodMatch';
import type { Micros, Nutrients } from '../src/types';

let indexed: { foods: TableFood[]; index: FoodIndex } | null = null;

async function currentIndex(): Promise<FoodIndex | null> {
  const foods = await tableFoods();
  if (!foods.length) return null;
  if (indexed?.foods !== foods) indexed = { foods, index: indexFoods(foods) };
  return indexed.index;
}

const MACROS = ['calories', 'protein', 'carbs', 'fat', 'fibre', 'sugar', 'satFat', 'sodium'] as const;
const MICRO_KEYS = ['iron', 'calcium', 'vitaminD', 'vitaminB12', 'folate', 'vitaminC'] as const;

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * The table's figures for this many grams, over the AI's wherever the table
 * has one. Free sugar stays the AI's judgement (no table measures it), and
 * is capped at the new total when the analysis is read.
 */
export function scaled(per100: Per100, grams: number, ai: Partial<Nutrients> = {}): Partial<Nutrients> {
  const factor = grams / 100;
  const out: Partial<Nutrients> = { ...ai };
  for (const key of MACROS) {
    const value = per100[key];
    if (typeof value === 'number') out[key] = round(value * factor, key === 'calories' || key === 'sodium' ? 0 : 1);
  }
  const micros: Micros = { ...(ai.micros ?? {}) };
  for (const key of MICRO_KEYS) {
    const value = per100[key];
    if (typeof value === 'number') micros[key] = round(value * factor, 2);
  }
  if (Object.keys(micros).length) out.micros = micros;
  return out;
}

/** The meal, with every plain food it can match taken from the table. */
export async function groundMeal(meal: ModelMeal): Promise<ModelMeal> {
  const items = meal.items ?? [];
  if (!items.some((item) => item.lookup?.trim())) return meal;

  let index: FoodIndex | null;
  try {
    index = await currentIndex();
  } catch (error) {
    console.warn('[squish] food table unavailable:', error instanceof Error ? error.message : error);
    return meal;
  }
  if (!index) return meal;

  const matched: string[] = [];
  const grounded = items.map((item) => {
    const lookup = item.lookup?.trim();
    const grams = item.grams;
    if (!lookup || typeof grams !== 'number' || grams <= 0) return item;
    const aiCalories = item.nutrients?.calories ?? 0;
    for (const food of candidates(lookup, index)) {
      const calories = typeof food.per100.calories === 'number' ? (food.per100.calories * grams) / 100 : NaN;
      if (!Number.isFinite(calories) || !plausible(aiCalories, calories)) continue;
      matched.push(food.name);
      return { ...item, nutrients: scaled(food.per100, grams, item.nutrients), source: { table: food.source, id: food.id, name: food.name } };
    }
    return item;
  });

  const named = items.filter((item) => item.lookup?.trim()).length;
  console.info(`[squish] food table: ${matched.length} of ${items.length} foods (${named} named)${matched.length ? ` — ${matched.join('; ')}` : ''}`);
  return { ...meal, items: grounded };
}
