/**
 * Barcode lookups, against Open Food Facts.
 *
 * Their data is free and needs no key, but it is a volunteer-run charity and
 * they ask two things of anyone using it: identify yourself with a real
 * User-Agent, and stay under fifteen product reads a minute. A browser cannot
 * set a User-Agent, so the lookup goes through here — which honours the first
 * request but means the second is shared across everyone using this server.
 * Hence the cache: scanning the same tin twice should cost them nothing.
 *
 * https://world.openfoodfacts.org — data under the Open Database Licence.
 */
import type { AnalysisResult, FoodItem, MealSlot, Nutrients } from '../src/types';
import { sumNutrients } from '../src/lib/nutrition';
import { looksLikeBarcode } from '../src/lib/gtin';

const API = 'https://world.openfoodfacts.org/api/v2/product';
const AGENT = 'Squish/1.0 (https://github.com/pablomilla/squish)';

/** Only what we use — their full record is enormous. */
const FIELDS = [
  'product_name',
  'quantity',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'nutriments',
].join(',');

/** Their limit is per minute; ours is deliberately under it. */
const MAX_PER_MINUTE = 12;
const CACHE_MAX = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; result: AnalysisResult | null }>();
let windowStart = 0;
let callsThisWindow = 0;

export class BarcodeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}



function takeSlot(): void {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    callsThisWindow = 0;
  }
  if (callsThisWindow >= MAX_PER_MINUTE) {
    throw new BarcodeError(429, 'Lots of scanning going on — give it a minute and try again.');
  }
  callsThisWindow += 1;
}

const num = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

type Nutriments = Record<string, unknown>;

/**
 * Their figures are per 100 g, in grams, with energy in whichever unit the
 * contributor had. Ours are per portion, with sodium in milligrams and fibre
 * counted inside carbohydrate. Every line here is one of those differences.
 */
function nutrientsPer100(n: Nutriments): Nutrients | null {
  const kcal = num(n['energy-kcal_100g']) ?? (num(n['energy-kj_100g']) !== undefined ? num(n['energy-kj_100g'])! / 4.184 : undefined);
  if (kcal === undefined) return null; // Without energy there is nothing to log.

  const fibre = num(n.fiber_100g) ?? 0;
  // Europe declares carbohydrate net of fibre; we count fibre inside it, the
  // way the label does in the States. `carbohydrates-total` is their gross
  // figure where a contributor has entered one.
  const carbs = num(n['carbohydrates-total_100g']) ?? (num(n.carbohydrates_100g) ?? 0) + fibre;

  // Sodium comes in grams, and is often absent where salt is given instead.
  const sodiumG = num(n.sodium_100g) ?? (num(n.salt_100g) !== undefined ? num(n.salt_100g)! / 2.5 : undefined) ?? 0;

  // Saturates are left undefined rather than nought where nobody has entered
  // them: a product with no figure is not a product with none in it.
  const sat = num(n['saturated-fat_100g']);

  return {
    calories: Math.round(kcal),
    protein: round1(num(n.proteins_100g) ?? 0),
    carbs: round1(carbs),
    fat: round1(num(n.fat_100g) ?? 0),
    fibre: round1(fibre),
    satFat: sat === undefined ? undefined : round1(sat),
    sugar: round1(num(n.sugars_100g) ?? 0),
    sodium: Math.round(sodiumG * 1000),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const scale = (per100: Nutrients, grams: number): Nutrients => {
  const f = grams / 100;
  return {
    calories: Math.round(per100.calories * f),
    protein: round1(per100.protein * f),
    carbs: round1(per100.carbs * f),
    fat: round1(per100.fat * f),
    fibre: round1(per100.fibre * f),
    satFat: per100.satFat === undefined ? undefined : round1(per100.satFat * f),
    sugar: round1((per100.sugar ?? 0) * f),
    sodium: Math.round((per100.sodium ?? 0) * f),
  };
};

interface OffProduct {
  product_name?: string;
  serving_size?: string;
  serving_quantity?: string | number;
  serving_quantity_unit?: string;
  nutriments?: Nutriments;
}

export function toAnalysis(product: OffProduct, code: string, slot?: MealSlot): AnalysisResult | null {
  const per100 = product.nutriments ? nutrientsPer100(product.nutriments) : null;
  if (!per100) return null;

  const servingG = num(product.serving_quantity);
  // A stated serving is used when it is a believable one; otherwise 100 g,
  // which is what the figures are given for anyway.
  const usable = servingG !== undefined && servingG >= 1 && servingG <= 2000;
  const grams = usable ? Math.round(servingG) : 100;
  const liquid = product.serving_quantity_unit === 'ml';

  const name = product.product_name?.trim() || `Item ${code}`;
  const item: FoodItem = {
    id: `off-${code}`,
    name,
    emoji: liquid ? '🥤' : '🏷️',
    portion: usable ? (product.serving_size?.trim() || '1 serving') : '',
    grams,
    liquid,
    nutrients: scale(per100, grams),
  };

  return {
    title: name,
    slot: slot ?? 'snack',
    confidence: 'high',
    score: 0, // Scored by the app from the nutrients, same as any other meal.
    coachNote: '',
    items: [item],
    nutrients: sumNutrients([item]),
  };
}

export async function lookupBarcode(code: string, slot?: MealSlot): Promise<AnalysisResult> {
  if (!looksLikeBarcode(code)) throw new BarcodeError(400, 'That does not look like a barcode.');

  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    if (!hit.result) throw new BarcodeError(404, notFound);
    return { ...hit.result, slot: slot ?? hit.result.slot };
  }

  takeSlot();

  let response: Response;
  try {
    response = await fetch(`${API}/${code}.json?fields=${FIELDS}`, {
      headers: { 'User-Agent': AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BarcodeError(504, 'The food database did not answer. Try again in a moment.');
  }

  if (response.status === 404) {
    remember(code, null);
    throw new BarcodeError(404, notFound);
  }
  if (!response.ok) throw new BarcodeError(502, 'The food database is having a moment. Try again shortly.');

  const body = (await response.json().catch(() => null)) as { status?: number; product?: OffProduct } | null;
  if (!body || body.status !== 1 || !body.product) {
    remember(code, null);
    throw new BarcodeError(404, notFound);
  }

  const analysis = toAnalysis(body.product, code, slot);
  if (!analysis) {
    // The product is known but nobody has filled in its nutrition. Not worth
    // caching as a miss — someone may add it tomorrow.
    throw new BarcodeError(422, 'That product is in the database, but without any nutrition on it yet.');
  }

  remember(code, analysis);
  return analysis;
}

const notFound = 'No such product in the database — it is a public one, so it may just not be added yet.';

function remember(code: string, result: AnalysisResult | null): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(code, { at: Date.now(), result });
}

/** Test seam: the cache would otherwise leak between cases. */
export function clearBarcodeCache(): void {
  cache.clear();
  windowStart = 0;
  callsThisWindow = 0;
}
