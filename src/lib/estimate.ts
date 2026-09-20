/**
 * Offline meal estimator.
 *
 * Used in two places: by the API server when no ANTHROPIC_API_KEY is configured,
 * and by the app itself when the server cannot be reached at all. Everything it
 * returns is flagged `offline: true` so the UI can say plainly that the numbers
 * are a local estimate rather than a vision analysis.
 */
import type { AnalysisResult, FoodItem, MealSlot } from '../types';
import { FOODS, searchFoods, toFoodItem, type FoodRecord } from './foods';
import { qualityScore, round1, sumNutrients, ultraProcessedShare } from './nutrition';

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  half: 0.5, double: 2, couple: 2, few: 3,
};

const UNIT_GRAMS: Record<string, number> = {
  g: 1, gram: 1, grams: 1, kg: 1000, oz: 28.35, lb: 454,
};

const SPLIT = /\s*(?:,|\band\b|\bwith\b|\bplus\b|\+|&|\n)\s*/i;

interface ParsedPart {
  servings: number;
  grams?: number;
  text: string;
}

function parsePart(raw: string): ParsedPart {
  const text = raw.trim().toLowerCase().replace(/^(?:some|a bit of|a|an|my|the)\s+/, '');
  let servings = 1;
  let grams: number | undefined;

  const gramMatch = text.match(/(\d+(?:\.\d+)?)\s*(kg|g|grams?|oz|lb)\b/);
  if (gramMatch) {
    grams = Number(gramMatch[1]) * (UNIT_GRAMS[gramMatch[2]] ?? 1);
  }

  const numMatch = text.match(/^(\d+(?:\.\d+)?)\s/);
  if (numMatch) servings = Number(numMatch[1]);
  else {
    const word = text.split(/\s+/)[0];
    if (word in NUMBER_WORDS) servings = NUMBER_WORDS[word];
  }

  if (/\b(large|big|generous|heaped)\b/.test(text)) servings *= 1.35;
  if (/\b(small|light|little|mini)\b/.test(text)) servings *= 0.7;

  return { servings: Math.max(0.25, Math.min(12, servings)), grams, text };
}

function matchFood(text: string): FoodRecord | undefined {
  const cleaned = text.replace(/\d+(?:\.\d+)?\s*(kg|g|grams?|oz|lb)?/g, ' ').trim();
  const direct = searchFoods(cleaned, 1)[0];
  if (direct) return direct;
  // Fall back to the longest word that hits anything at all.
  const words = cleaned.split(/\s+/).filter((w) => w.length > 2).sort((a, b) => b.length - a.length);
  for (const w of words) {
    const hit = searchFoods(w, 1)[0];
    if (hit) return hit;
  }
  return undefined;
}

const MEASURES = /^(?:g|kg|ml|cl|l|oz|lb|grams?)$/;

/**
 * "2 eggs" as a serving label means asking for two eggs is one serving, not two.
 * A measurement like "330 ml can" is a single serving, however many millilitres.
 */
function unitsPerServing(food: FoodRecord): number {
  const count = food.serving.match(/^(\d+(?:\.\d+)?)\s+([a-z]+)/i);
  if (!count) return 1;
  const units = Number(count[1]);
  if (MEASURES.test(count[2].toLowerCase()) || units > 12) return 1;
  return units;
}

function itemFor(part: ParsedPart): FoodItem | undefined {
  const food = matchFood(part.text);
  if (!food) return undefined;
  const servings = part.grams
    ? part.grams / food.servingG
    : part.servings / unitsPerServing(food);
  const item = toFoodItem(food, round1(servings));
  if (part.grams) item.portion = `${Math.round(part.grams)} g`;
  return item;
}

function titleFrom(items: FoodItem[], fallback: string): string {
  if (!items.length) return fallback;
  if (items.length === 1) return items[0].name;
  if (items.length === 2) return `${items[0].name} & ${items[1].name}`;
  return `${items[0].name} +${items.length - 1} more`;
}

function noteFor(result: { score: number; items: FoodItem[] }): string {
  const { score, items } = result;
  if (!items.length) return "I could not place that one — try searching the food list and I'll do the maths.";
  if (score >= 75) return 'Lovely balance — plenty of protein and fibre in there. High five!';
  if (score >= 55) return 'Nicely balanced. A handful of veg alongside would top it off.';
  if (score >= 38) return 'Tasty! Maybe pair it with something green or a protein boost later.';
  return 'Enjoy it — no guilt here. Something lighter next meal will even the day out.';
}

/** Parse a free-text meal description into an estimated analysis. */
export function estimateFromText(description: string, slot?: MealSlot): AnalysisResult {
  const parts = description.split(SPLIT).map((s) => s.trim()).filter(Boolean);
  const items = parts.map(parsePart).map(itemFor).filter((x): x is FoodItem => Boolean(x));
  const nutrients = sumNutrients(items);
  const score = qualityScore(nutrients, ultraProcessedShare(items));
  return {
    title: titleFrom(items, description.slice(0, 40) || 'Meal'),
    slot,
    items,
    nutrients,
    score,
    coachNote: noteFor({ score, items }),
    confidence: items.length === parts.length && items.length > 0 ? 'medium' : 'low',
    offline: true,
  };
}

/** Deterministic stand-in for photo analysis when no model is configured. */
export function demoEstimateFromPhoto(seed: string, slot?: MealSlot): AnalysisResult {
  const plates: Record<string, string[]> = {
    breakfast: ['oats', 'blueberries', 'greek-yog'],
    lunch: ['chicken-bowl', 'avocado', 'salad'],
    dinner: ['salmon', 'brown-rice', 'broccoli'],
    snack: ['apple', 'almonds'],
  };
  const pick = plates[slot ?? 'lunch'] ?? plates.lunch;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100_000;
  const wobble = 0.85 + ((hash % 30) / 100);

  const items = pick
    .map((id) => FOODS.find((f) => f.id === id))
    .filter((f): f is FoodRecord => Boolean(f))
    .map((f) => toFoodItem(f, round1(wobble)));

  const nutrients = sumNutrients(items);
  return {
    title: titleFrom(items, 'Your meal'),
    slot,
    items,
    nutrients,
    score: qualityScore(nutrients, ultraProcessedShare(items)),
    coachNote:
      'Demo estimate — I could not look at the photo without an Anthropic API key, so this is a typical plate. Tweak the items and they are yours.',
    confidence: 'low',
    offline: true,
  };
}
