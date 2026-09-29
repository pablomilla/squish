/**
 * Claude-powered meal analysis.
 *
 * Vision + structured outputs: the model looks at the photo (or reads the
 * description) and returns JSON that matches MEAL_SCHEMA exactly, so the app
 * never has to parse prose into numbers.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { FoodSource, AnalysisResult, MealSlot, Micros, Nutrients } from '../src/types';
import { MICROS } from '../src/types';
import { addMicros, addOptional, qualityScore, ultraProcessedShare } from '../src/lib/nutrition';
import { RECIPE_SYSTEM, recipePrompt, type RecipeImport, type RecipeSource } from './recipe';
import { bill } from './billing';
import { priceUsage } from './pricing';
import { createMessage, streamMessage, thinkingOff } from './providers';
import { repeating } from './runaway';
import { withModels, type Feature } from './routing';

export { priceUsage, type TokenCounts } from './pricing';
import { regionNote } from './region';
import { groundMeal } from './grounding';
import { tableFoods } from './foodTable';
import { readTranslation, translateRequest, TranslationTooLong, type CatalogEntry } from './translate';
import type { Pack } from '../src/lib/language';
import { AISLES, isAisle } from '../src/lib/shopping';
import { msg } from '../src/lib/i18n';

const AISLE_IDS = AISLES.map((a) => a.id);
import { WEEKPLAN_SCHEMA, WEEKPLAN_SYSTEM, floorFor, weekPlanPrompt, type WeekPlanRequest } from './weekplan';
import { aimLines, eatingLines, type About } from '../src/lib/eating';

/**
 * Words rather than pictures — a meal typed or spoken, a correction, the
 * answer to a question about one — go to a cheaper model. Reading a photo is
 * the hard part, and stays on MODEL; turning "two slices of toast with
 * butter" into nutrition is well within Sonnet 5, at 40% of the price per
 * token and quicker. The default for the words routes (server/routing.ts),
 * where the dashboard can change it; shown in the startup banner.
 */
export const TEXT_MODEL = process.env.SQUISH_TEXT_MODEL ?? 'claude-sonnet-5';

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
  latencyMs: number;
}

export interface DetailedAnalysis {
  /** Whatever the model actually returned, for the fields only some jobs ask for. */
  raw?: { servings?: number };
  analysis: AnalysisResult;
  usage: ModelUsage;
}



/**
 * True when the SDK will be able to authenticate, by any of the routes it
 * resolves: an API key, an auth token, or workload identity federation — where
 * the host mints a short-lived identity token and there is no key at all.
 * Miss the federation case and the app quietly serves offline estimates.
 */
export function hasCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  return Boolean(
    process.env.ANTHROPIC_FEDERATION_RULE_ID &&
      process.env.ANTHROPIC_ORGANIZATION_ID &&
      process.env.ANTHROPIC_SERVICE_ACCOUNT_ID &&
      (process.env.ANTHROPIC_IDENTITY_TOKEN_FILE || process.env.ANTHROPIC_IDENTITY_TOKEN),
  );
}

/** How the SDK will authenticate, for the startup banner and the check script. */
export function credentialSource(): 'api-key' | 'auth-token' | 'federation' | 'none' {
  if (process.env.ANTHROPIC_API_KEY) return 'api-key';
  if (process.env.ANTHROPIC_AUTH_TOKEN) return 'auth-token';
  return hasCredentials() ? 'federation' : 'none';
}


const NUTRIENT_PROPS = {
  calories: { type: 'number', description: 'kcal' },
  protein: { type: 'number', description: 'grams' },
  carbs: { type: 'number', description: 'grams, total carbohydrate' },
  fat: { type: 'number', description: 'grams' },
  fibre: { type: 'number', description: 'grams' },
  satFat: { type: 'number', description: 'grams of saturated fat, counted inside fat' },
  sugar: { type: 'number', description: 'grams of total sugars' },
  freeSugar: {
    type: 'number',
    description:
      'grams of FREE sugars, counted inside sugar: added sugar and syrups, honey, and the sugar in fruit juice. The sugar in whole fruit, vegetables and plain milk or yoghurt is NOT free — that is 0. Never larger than sugar.',
  },
  sodium: { type: 'number', description: 'milligrams' },
  micros: {
    type: 'object',
    description: 'Vitamins and minerals for this portion. Estimate them from the food, as a composition table would.',
    properties: {
      iron: { type: 'number', description: 'milligrams' },
      calcium: { type: 'number', description: 'milligrams' },
      vitaminD: { type: 'number', description: 'micrograms' },
      vitaminB12: { type: 'number', description: 'micrograms' },
      folate: { type: 'number', description: 'micrograms' },
      vitaminC: { type: 'number', description: 'milligrams' },
    },
    required: ['iron', 'calcium', 'vitaminD', 'vitaminB12', 'folate', 'vitaminC'],
    additionalProperties: false,
  },
} as const;

/** Everything about one item's nutrition, for the portion stated. */
const ITEM_NUTRIENTS = {
  type: 'object',
  properties: NUTRIENT_PROPS,
  required: ['calories', 'protein', 'carbs', 'fat', 'fibre', 'satFat', 'sugar', 'freeSugar', 'sodium', 'micros'],
  additionalProperties: false,
} as const;

export const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short friendly name for the whole meal, max 5 words' },
    slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'How sure you are about the portions and identification',
    },
    score: {
      type: 'integer',
      description: 'Diet-quality score 0-100 for this meal: protein and fibre density lift it, heavy added sugar, saturated fat and sodium pull it down. Unsaturated fat — olive oil, nuts, oily fish, avocado — is not a mark against a meal.',
    },
    coachNote: {
      type: 'string',
      description:
        'One or two warm, non-judgemental sentences from Squish, a friendly blob mascot. Encouraging, never shaming, max 220 characters. Mention one concrete nutrition observation.',
    },
    question: {
      type: 'string',
      description:
        'One short question about the single thing you could not tell that would change the calories most, in the language given below — or an empty string when there is nothing worth asking.',
    },
    choices: {
      type: 'array',
      items: { type: 'string' },
      description: 'Two to four short answers to the question, a few words each, most likely first, in the same language. Empty when the question is empty.',
    },
    items: {
      type: 'array',
      description: 'Every distinct food or drink you can identify, with its own estimated nutrition',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          emoji: { type: 'string', description: 'One emoji that suits the food' },
          portion: {
            type: 'string',
            description:
              'What the portion was, in words only: "1 bowl", "1 medium apple", "2 slices". No weights — the app shows those itself, from grams, and would print them twice.',
          },
          grams: { type: 'number', description: 'Estimated edible weight in grams' },
          liquid: {
            type: 'boolean',
            description: 'True for a drink, soup or anything else a person measures by volume rather than weight',
          },
          ultraProcessed: {
            type: 'boolean',
            description:
              'NOVA group 4: industrially formulated from refined substances and additives rather than cooked from food. True for crisps, confectionery, soft drinks, mass-produced biscuits and pastries, breakfast cereals, instant noodles, reconstituted meat, formulated powders. False for anything cooked from ingredients, whole foods, plain dairy, bread from a bakery, and for a restaurant or home-cooked dish.',
          },
          aisle: {
            type: 'string',
            enum: AISLE_IDS,
            description: 'The part of a supermarket this is bought from, for the shopping list',
          },
          lookup: {
            type: 'string',
            description:
              "The food as a food composition table lists it, in English whatever language the rest is in, with how it was prepared as eaten: 'banana, raw', 'rice, white, cooked', 'egg, whole, hard-boiled', 'chicken breast, meat only, roasted', 'cheddar cheese', 'whole milk', 'olive oil'. An empty string for a mixed dish, a restaurant or takeaway dish, or a branded product.",
          },
          nutrients: ITEM_NUTRIENTS,
        },
        required: ['name', 'emoji', 'portion', 'grams', 'liquid', 'ultraProcessed', 'aisle', 'lookup', 'nutrients'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'slot', 'confidence', 'score', 'coachNote', 'items', 'question', 'choices'],
  additionalProperties: false,
} as const;

export const SYSTEM = `You are the nutrition engine behind Squish, a friendly food-tracking app.

Your job is to identify what someone ate and estimate its nutrition as accurately as a careful dietitian would.

Rules:
- Estimate realistic portions from visual cues, and say so honestly when there are none: plate and bowl size, cutlery, hands, packaging.
- Look for something of known size in the frame and measure against it. A dinner fork is about 19 cm, a teaspoon 13 cm, a standard mug holds 300 ml, a can 330 ml, a credit card is 8.6 cm, an adult palm is roughly 9 cm across. A plate photographed from above gives a scale for everything on it.
- Where the person has told us the size of their own plate or bowl, that is the best ruler in the picture. Use it over any general assumption.
- portion names what it was; grams carries how much it weighed. Keep weights out of the portion text.
- Describe the amount that is actually there, not the size it came in: a glass half full of lager is "half a pint", not "1 pint". People photograph food part-way through.
- Break the meal into the individual foods you can actually see or that were described. Do not invent sides that are not there.
- Nutrition values are per the portion you state, not per 100 g.
- Count fibre inside total carbohydrate, and give sugar as total sugars.
- micros are per portion, estimated the way a food composition table would have them. Flour and breakfast cereals are fortified in most countries (what is added where they live is below), so bread and cereal carry more than the raw grain does. Oily fish and eggs are the food sources of vitamin D; B12 comes only from animal foods and things fortified with it.
- freeSugar is the added-and-juice share of sugar, counted inside it. An apple, a banana, a carrot and a glass of milk are all 0 — their sugar is not free sugar and no guideline asks anyone to cut it. Juice, honey, syrup, and anything sweetened in a kitchen or a factory is.
- satFat is the saturated share of fat, counted inside it, and is never larger than fat. It is what the app judges a meal on, so it is worth getting right: butter, cream, cheese, coconut, fatty red meat and pastry are mostly saturated; olive oil, rapeseed, nuts, seeds, avocado and oily fish are mostly not.
- If the image is not food at all, return an empty items array, a score of 0, and say so kindly in coachNote.
- ultraProcessed asks how the food was made, not whether it is good for someone. A home-cooked shepherd's pie is false however much fat is in it; a diet cola is true however few calories are in it.
- lookup names a plain food the way a food composition table would, in English, with how it was prepared as eaten ("rice, white, cooked", not just "rice"; "banana, raw"), so its nutrition per gram can be taken from the table. Leave it empty for anything a table cannot answer: a mixed or composite dish, a restaurant or takeaway dish, a branded product. Your own nutrition figures are still needed for every item.
- aisle is the part of a supermarket the item is bought from. A meal can be planned for later and put on a shopping list, which is sorted by it whatever language the names are in; a cooked dish is under the aisle of its main ingredient, and a takeaway or restaurant dish under "other".
- confidence is "low" when the photo is blurry, partly hidden, or the dish could be made many ways.
- question is for the one thing you could not tell that would move the calories by about 50 kcal or more: which dressing or sauce, what it was cooked in, whole or skimmed milk, sugar in a drink, a portion hidden from view. Read the meal on your best guess anyway — the question is a way to make it better, not a reason to leave it unfinished — and give 2 to 4 short choices, your best guess first. Ask only one, never about something plainly visible or already described, and leave question and choices empty when nothing would change the numbers that much. Most meals need no question.
- coachNote is written in Squish's voice: warm, playful, encouraging, never moralising about "bad" food, in the language given below.`;

/** Only the six we know about, only as non-negative numbers. */
function coerceMicros(raw: unknown): Micros | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const out: Micros = {};
  for (const key of MICROS) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = Math.max(0, value);
  }
  return Object.keys(out).length ? out : undefined;
}

function coerceNutrients(raw: Partial<Nutrients> | undefined): Nutrients {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
  const fat = num(raw?.fat);
  const sugar = num(raw?.sugar);
  return {
    calories: Math.round(num(raw?.calories)),
    protein: num(raw?.protein),
    carbs: num(raw?.carbs),
    fat,
    fibre: num(raw?.fibre),
    // Saturates live inside total fat, so a larger figure is a slip rather
    // than a finding. Absent stays absent — see Nutrients.satFat.
    satFat: raw?.satFat === undefined ? undefined : Math.min(fat, num(raw.satFat)),
    sugar,
    // Free sugars live inside total sugars, the same way saturates live
    // inside fat, so a larger figure is a slip rather than a finding.
    freeSugar: raw?.freeSugar === undefined ? undefined : Math.min(sugar, num(raw.freeSugar)),
    sodium: Math.round(num(raw?.sodium)),
    micros: coerceMicros(raw?.micros),
  };
}

export interface ModelMeal {
  /** Recipes only: how many servings the whole thing makes. */
  servings?: number;
  /** What it would ask, if anything, and the answers to tap. */
  question?: string;
  choices?: string[];
  title?: string;
  slot?: MealSlot;
  confidence?: 'high' | 'medium' | 'low';
  score?: number;
  coachNote?: string;
  items?: {
    name?: string;
    emoji?: string;
    portion?: string;
    grams?: number;
    liquid?: boolean;
    ultraProcessed?: boolean;
    /** Where it is bought: every analysis and weekly plan gives one. */
    aisle?: string;
    /** The food in a food table's words, for matching (server/grounding.ts); empty for a dish. */
    lookup?: string;
    /** Set by the matching, not the model: the table the per-gram figures came from. */
    source?: FoodSource;
    nutrients?: Partial<Nutrients>;
  }[];
}

export function toAnalysis(parsed: ModelMeal, fallbackSlot?: MealSlot): AnalysisResult {
  const items = (parsed.items ?? []).map((item, index) => ({
    id: `ai-${Date.now()}-${index}`,
    name: item.name?.trim() || 'Food',
    emoji: item.emoji || '🍽️',
    portion: item.portion?.trim() || '1 serving',
    grams: typeof item.grams === 'number' ? Math.round(item.grams) : undefined,
    liquid: item.liquid === true,
    ultraProcessed: item.ultraProcessed === true,
    ...(isAisle(item.aisle) ? { aisle: item.aisle } : {}),
    nutrients: coerceNutrients(item.nutrients),
    ...(item.source ? { source: item.source } : {}),
  }));

  const nutrients = items.reduce<Nutrients>(
    (acc, item) => ({
      calories: acc.calories + item.nutrients.calories,
      protein: acc.protein + item.nutrients.protein,
      carbs: acc.carbs + item.nutrients.carbs,
      fat: acc.fat + item.nutrients.fat,
      fibre: acc.fibre + item.nutrients.fibre,
      satFat: addOptional(acc.satFat, item.nutrients.satFat),
      sugar: (acc.sugar ?? 0) + (item.nutrients.sugar ?? 0),
      freeSugar: addOptional(acc.freeSugar, item.nutrients.freeSugar),
      sodium: (acc.sodium ?? 0) + (item.nutrients.sodium ?? 0),
      micros: addMicros(acc.micros, item.nutrients.micros),
    }),
    {
      calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0, sodium: 0,
      satFat: undefined as number | undefined,
      freeSugar: undefined as number | undefined,
    },
  );

  const asked = clarifyFrom(parsed);
  const score =
    typeof parsed.score === 'number' && parsed.score > 0
      ? Math.max(0, Math.min(100, Math.round(parsed.score)))
      : qualityScore(nutrients, ultraProcessedShare(items));

  return {
    title: parsed.title?.trim() || 'Your meal',
    slot: parsed.slot ?? fallbackSlot,
    items,
    nutrients,
    score,
    coachNote: parsed.coachNote?.trim() || 'Logged! Every entry helps me understand your day.',
    confidence: parsed.confidence ?? 'medium',
    ...(asked ? { clarify: asked } : {}),
  };
}

/**
 * The model's question, if it asked a real one: a question of sensible length
 * with two to four distinct, short answers. Anything else is dropped rather
 * than shown half-formed — the meal is complete without it.
 */
export function clarifyFrom(parsed: Pick<ModelMeal, 'question' | 'choices'>): { question: string; choices: string[] } | undefined {
  const question = parsed.question?.trim() ?? '';
  if (question.length < 5 || question.length > 160) return undefined;
  const choices = [...new Set((parsed.choices ?? []).map((c) => (typeof c === 'string' ? c.trim() : '')).filter((c) => c && c.length <= 60))].slice(0, 4);
  return choices.length >= 2 ? { question, choices } : undefined;
}

/**
 * Haiku predates adaptive thinking and rejects output_config.effort, so the
 * request shape is per model family rather than one size fits all.
 */
/** The meal shape, plus how many servings the recipe makes. */
const RECIPE_SCHEMA = {
  ...MEAL_SCHEMA,
  properties: {
    ...MEAL_SCHEMA.properties,
    servings: {
      type: 'integer',
      description: 'How many servings the whole recipe makes. The items you return are for ONE of them.',
    },
  },
  required: [...MEAL_SCHEMA.required, 'servings'],
} as const;

function tuningFor(model: string, schema: Record<string, unknown> = MEAL_SCHEMA): Pick<Anthropic.MessageCreateParamsNonStreaming, 'thinking' | 'output_config'> {
  const format = { type: 'json_schema', schema } as const;
  // Haiku has no adaptive thinking, and Gemini thinks in its own way: the schema is all either takes.
  if (model.startsWith('claude-haiku') || model.startsWith('gemini-')) {
    return { output_config: { format } };
  }
  return {
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format },
  };
}

/** Charge a price to whoever is being served, against its model, and hand it straight back. */
function billed(usd: number | null, model: string): number | null {
  bill(usd, model);
  return usd;
}

/*
 * Table first.
 *
 * Once a food table is loaded, a plain food's nutrition comes from it — so
 * asking the model for all fifteen figures of a banana, only to throw them
 * away, is paying for output nobody uses. For an item it names in a table's
 * words (a `lookup`), the model gives just two: its calories, which is how a
 * table match is checked (server/foodMatch.ts), and the share of sugar that
 * is free sugar, which no table measures. A dish, a takeaway or a branded
 * product still gets everything, in the same answer.
 *
 * A named food the table then cannot answer is filled in by a short
 * text-only question to the cheaper text model (`fillFigures`), with no
 * photo. Whether this saves money overall depends on how often named foods
 * match — every analysis logs the split, and SQUISH_TABLE_FIRST=off goes back
 * to asking for everything.
 */
export const TABLE_FIRST_RULE = `- nutrients: for an item with a lookup, give only calories and freeSugar — its other figures come from a food table, so leave them out. For an item without a lookup, give all of them.`;

/**
 * A schema with every food item's nutrients optional, so a table food can
 * carry just two — wherever items sit in it: a meal's items, or a week's
 * days of meals of items. An item is anything with both a `lookup` and
 * `nutrients`.
 */
export function briefSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const relax = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(relax);
    if (!node || typeof node !== 'object') return node;
    const out = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, relax(value)])) as Record<string, unknown>;
    const properties = out.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties?.lookup && properties.nutrients) {
      out.properties = {
        ...properties,
        nutrients: {
          ...properties.nutrients,
          required: [],
          description: 'Only calories and freeSugar for an item with a lookup; everything for an item without one.',
        },
      };
    }
    return out;
  };
  return relax(schema) as Record<string, unknown>;
}

/** Whether to ask table first: a table to answer from, and not a label (whose printed figures are the truth). */
export async function tableFirst(system: string): Promise<boolean> {
  if (system === LABEL_SYSTEM || process.env.SQUISH_TABLE_FIRST === 'off') return false;
  try {
    return (await tableFoods()).length > 0;
  } catch {
    return false;
  }
}

/** Nutrition the table did not supply and the model was not asked for. */
const missingFigures = (item: NonNullable<ModelMeal['items']>[number]): boolean =>
  !item.source && (['protein', 'carbs', 'fat'] as const).some((key) => typeof item.nutrients?.[key] !== 'number');

const FILL_SYSTEM = `You are the nutrition engine behind Squish, a food-tracking app. You are given foods from one meal, each with its portion and weight, and return each one's nutrition for that portion, in the same order.

Rules:
- Nutrition values are for the portion stated, not per 100 g.
- Count fibre inside total carbohydrate, and give sugar as total sugars.
- freeSugar is the added-and-juice share of sugar, counted inside it: 0 for fruit, vegetables and plain milk.
- satFat is the saturated share of fat, counted inside it, and is never larger than fat.
- micros, where asked for, are per portion, estimated the way a food composition table would have them, with fortification where they live (below).`;

/** The fill-in's answer: each food's figures, with vitamins and minerals or (for a week's plan) without. */
function fillSchema(micros: boolean): Record<string, unknown> {
  const { micros: _left, ...withoutMicros } = NUTRIENT_PROPS;
  const nutrients = micros
    ? ITEM_NUTRIENTS
    : { ...ITEM_NUTRIENTS, properties: withoutMicros, required: ITEM_NUTRIENTS.required.filter((key) => key !== 'micros') };
  return {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'object', properties: { nutrients }, required: ['nutrients'], additionalProperties: false } },
    },
    required: ['items'],
    additionalProperties: false,
  };
}

export interface CallCost {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number;
}

/**
 * A model's JSON answer, read — or a failure that says what went wrong. An
 * answer that ran to the output limit is reported as cut off, with how it
 * ended, rather than as the parse error it would otherwise be: Gemini now and
 * then gets stuck repeating something inside its JSON until it runs out of
 * room, and the ending shows what.
 */
export function readAnswer<T>(text: string, stop: string | null): T {
  const ending = () => JSON.stringify(text.slice(-60));
  if (stop === 'max_tokens') {
    const stuck = repeating(text);
    const looped = stuck ? `, stuck repeating ${JSON.stringify(stuck)}` : '';
    throw new Error(`The answer was cut off at ${text.length} characters${looped}; it ended ${ending()}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : 'Not JSON'}; it ended ${ending()}`);
  }
}

/**
 * The full figures for the named foods the table could not answer: one
 * text-only question, no photo, on the 'fill' route (the cheaper text model
 * first). Nothing to fill, nothing asked.
 */
export async function fillFigures(meal: ModelMeal, micros = true): Promise<{ meal: ModelMeal; filled: number; cost: CallCost | null }> {
  const items = meal.items ?? [];
  const needing = items.map((item, index) => ({ item, index })).filter(({ item }) => missingFigures(item));
  if (!needing.length) return { meal, filled: 0, cost: null };

  const prompt = [
    `These foods are part of a meal read as "${meal.title ?? 'a meal'}". Give each one's nutrition for the portion stated, in this order:`,
    ...needing.map(({ item }, n) => `${n + 1}. ${item.name ?? 'Food'} — ${item.portion ?? 'a portion'}${item.grams ? `, ${Math.round(item.grams)} g` : ''}${item.lookup ? ` (${item.lookup})` : ''}`),
  ].join('\n');

  const ask = async (model: string, _attempt: number, signal: AbortSignal) => {
    const startedAt = Date.now();
    const response = await createMessage({
      model,
      // A week can leave dozens of foods to fill; room for each, and for thinking.
      max_tokens: Math.min(32000, 2000 + 300 * needing.length),
      system: `${FILL_SYSTEM}\n\n${regionNote('meal')}`,
      messages: [{ role: 'user', content: prompt }],
      ...tuningFor(model, fillSchema(micros)),
    }, signal);
    if (response.stop_reason === 'refusal') throw new Error('The model declined to fill in the figures.');
    const text = response.content.filter((block): block is Anthropic.TextBlock => block.type === 'text').map((block) => block.text).join('');
    const parsed = readAnswer<{ items?: { nutrients?: Partial<Nutrients> }[] }>(text, response.stop_reason);
    if ((parsed.items ?? []).length !== needing.length) throw new Error('The figures came back for the wrong number of foods.');
    const cost: CallCost = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: billed(priceUsage(model, { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }), response.model),
      latencyMs: Date.now() - startedAt,
    };
    return { figures: parsed.items!, cost };
  };

  const answer = await withModels('fill', ask);

  const next = [...items];
  needing.forEach(({ item, index }, n) => {
    const figures = answer.figures[n].nutrients ?? {};
    // The model's own free-sugar call from the first answer stands if the fill left it out.
    next[index] = { ...item, nutrients: { ...figures, freeSugar: figures.freeSugar ?? item.nutrients?.freeSugar } };
  });
  return { meal: { ...meal, items: next }, filled: needing.length, cost: answer.cost };
}

/**
 * Read a meal on the feature's route — each model in turn until one gives an
 * answer that parses — or on one model alone when the benchmark names it.
 */
function requestMeal(
  content: Anthropic.ContentBlockParam[],
  fallbackSlot: MealSlot | undefined,
  feature: Feature,
  system: string = SYSTEM,
  schema: Record<string, unknown> = MEAL_SCHEMA,
  pinned?: string,
): Promise<DetailedAnalysis> {
  return withModels(feature, (model, _attempt, signal) => requestMealOn(model, content, fallbackSlot, system, schema, signal), pinned ? { models: [pinned] } : {});
}

async function requestMealOn(
  model: string,
  content: Anthropic.ContentBlockParam[],
  fallbackSlot: MealSlot | undefined,
  system: string,
  schema: Record<string, unknown>,
  signal: AbortSignal,
): Promise<DetailedAnalysis> {
  const startedAt = Date.now();
  const brief = await tableFirst(system);
  const response = await createMessage({
    model,
    max_tokens: 8000,
    // Where they live goes last, after the rules every country shares.
    system: `${system}${brief ? `\n${TABLE_FIRST_RULE}` : ''}\n\n${regionNote(system === LABEL_SYSTEM ? 'label' : system === RECIPE_SYSTEM ? 'recipe' : 'meal')}`,
    messages: [{ role: 'user', content }],
    ...tuningFor(model, brief ? briefSchema(schema) : schema),
  }, signal);
  const latencyMs = Date.now() - startedAt;

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to analyse this image.');
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  const costUsd = billed(
    priceUsage(model, {
      inputTokens,
      outputTokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    }),
    response.model,
  );

  // A label's figures are printed, and are the truth; everything else is
  // checked against the food table where it names a plain food, and in
  // table-first mode the named foods it could not answer are filled in.
  const read = readAnswer<ModelMeal>(text, response.stop_reason);
  let parsed = system === LABEL_SYSTEM ? read : await groundMeal(read);
  let fill: CallCost | null = null;
  if (brief) {
    const done = await fillFigures(parsed);
    parsed = done.meal;
    fill = done.cost;
    const fromTable = parsed.items?.filter((item) => item.source).length ?? 0;
    console.info(
      `[squish] table first: ${fromTable} from the table, ${done.filled} filled in, ${(parsed.items?.length ?? 0) - fromTable - done.filled} from the first answer` +
        ` · ${outputTokens}${fill ? `+${fill.outputTokens}` : ''} output tokens`,
    );
  }

  return {
    analysis: toAnalysis(parsed, fallbackSlot),
    raw: parsed,
    usage: {
      model: response.model,
      inputTokens: inputTokens + (fill?.inputTokens ?? 0),
      outputTokens: outputTokens + (fill?.outputTokens ?? 0),
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      costUsd: costUsd === null ? null : costUsd + (fill?.costUsd ?? 0),
      latencyMs: latencyMs + (fill?.latencyMs ?? 0),
    },
  };
}

type ImageMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const asMedia = (mediaType: string): ImageMedia =>
  (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mediaType) ? mediaType : 'image/jpeg') as ImageMedia;

/** Full result including what the call cost — used by the benchmark. */
/** What the person has told us about the things they eat off. */
export interface Crockery {
  plateCm?: number;
  bowlMl?: number;
}

/**
 * A known-size object in the frame is worth more than any amount of guessing,
 * and the most reliable one is the plate it is served on — but only when the
 * size is real. The food is scaled by the ratio, so a 27 cm assumption about a
 * 20 cm plate makes the portion getting on for twice what it was. A wrong
 * ruler is worse than no ruler, which is why nothing is assumed here.
 */
export const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function crockeryNote(crockery?: Crockery): string {
  const parts: string[] = [];
  if (crockery?.plateCm) parts.push(`their dinner plate is ${crockery.plateCm} cm across`);
  if (crockery?.bowlMl) parts.push(`their usual bowl holds about ${crockery.bowlMl} ml`);
  // Nothing measured, nothing claimed. Silence leaves the model on its priors
  // about ordinary portions, which is a better place to be than holding a
  // ruler we made up.
  if (!parts.length) return '';
  return `${capitalise(parts.join(' and '))} — use that as the scale wherever it is in shot.`;
}

/**
 * What goes with a meal photo, in words. Shared with the benchmark's other
 * providers (server/gemini.ts), so every model is asked exactly the same.
 */
export function photoPrompt(slot?: MealSlot, hint?: string, crockery?: Crockery): string {
  return [
    `This is a photo of a ${slot ?? 'meal'} someone just ate or is about to eat.`,
    crockeryNote(crockery),
    hint ? `They added a note: "${hint}".` : '',
    'Identify every food and drink, estimate the portions from the visual cues, and return the nutrition.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The instructions for reading a meal, with where they live added: the same for every provider. */
export const mealSystem = (brief = false): string => `${SYSTEM}${brief ? `\n${TABLE_FIRST_RULE}` : ''}\n\n${regionNote('meal')}`;

export async function analysePhotoDetailed(
  imageBase64: string,
  mediaType: string,
  slot?: MealSlot,
  hint?: string,
  /** One model only, for the benchmark; left out, the photo route decides. */
  model?: string,
  crockery?: Crockery,
): Promise<DetailedAnalysis> {
  return requestMeal(
    [
      { type: 'image', source: { type: 'base64', media_type: asMedia(mediaType), data: imageBase64 } },
      { type: 'text', text: photoPrompt(slot, hint, crockery) },
    ],
    slot,
    'photo',
    SYSTEM,
    MEAL_SCHEMA,
    model,
  );
}

/**
 * Reading a label is a different job from looking at a plate: the numbers are
 * printed, so they are to be read rather than estimated, and being out by a
 * third — forgivable on a bowl of stew — is inexcusable here.
 */
const LABEL_SYSTEM = `You are the nutrition engine behind Squish, a friendly food-tracking app. You are reading a nutrition label on a packet.

Rules:
- Read the printed figures. Do not estimate, round generously, or fall back on what you know about similar products. If a figure is not legible, leave it out rather than inventing it.
- Use the per-serving column when the label has one, and set grams to that serving's weight. If the label only gives per 100 g, return the values for 100 g and say so in the portion.
- portion names the serving in words — "1 serving", "1 bar", "half the pack", "100 g" — and grams carries its weight.
- How a packet is laid out depends on the country; the rules for theirs are below. Fibre is used when it is printed and 0 when it genuinely is not.
- title is the product name from the packaging when you can read it, otherwise what the food plainly is.
- Return exactly one item unless the packet genuinely holds separate foods.
- If the photo is not a nutrition label — a plate of food, a barcode alone, a blurry mess — return an empty items array, a score of 0, and say so kindly in coachNote.
- confidence is "low" when the print is small, angled, or partly out of frame.
- question is an empty string and choices an empty list: a label is read, not guessed at.
- lookup is an empty string: the label's own figures are the ones to use.
- coachNote is written in Squish's voice: warm, playful, encouraging, never moralising about "bad" food, in the language given below.`;

export async function analyseLabel(
  imageBase64: string,
  mediaType: string,
  slot?: MealSlot,
): Promise<AnalysisResult> {
  const { analysis } = await requestMeal(
    [
      { type: 'image', source: { type: 'base64', media_type: asMedia(mediaType), data: imageBase64 } },
      {
        type: 'text',
        text: 'This is a photo of the nutrition information on a food packet. Read it and return the nutrition for one serving.',
      },
    ],
    slot,
    'label',
    LABEL_SYSTEM,
  );
  return analysis;
}

export async function analysePhoto(
  imageBase64: string,
  mediaType: string,
  slot?: MealSlot,
  hint?: string,
  crockery?: Crockery,
): Promise<AnalysisResult> {
  const { analysis } = await analysePhotoDetailed(imageBase64, mediaType, slot, hint, undefined, crockery);
  return analysis;
}

/**
 * A meal in words, on the 'words' route: the cheaper text model first, the
 * main one behind it — a refusal, an outage, a malformed answer. Words are
 * cheap to ask about twice; a meal logged as a rough offline guess because
 * the cheaper model had a bad moment is not.
 */
function requestText(content: Anthropic.ContentBlockParam[], slot: MealSlot | undefined): Promise<DetailedAnalysis> {
  return requestMeal(content, slot, 'words');
}

export async function analyseText(description: string, slot?: MealSlot): Promise<AnalysisResult> {
  const { analysis } = await requestText(
    [
      {
        type: 'text',
        text: `Someone logged this ${slot ?? 'meal'} by describing it: "${description}". Break it into foods, assume typical portions where they did not say, and return the nutrition.`,
      },
    ],
    slot,
  );
  return analysis;
}

/**
 * One serving of a recipe someone found on the web.
 *
 * The page has already been fetched and reduced to its ingredients by
 * `server/recipe.ts`; everything here is the estimating.
 */
export async function analyseRecipe(source: RecipeSource, slot?: MealSlot): Promise<RecipeImport> {
  const { analysis, raw } = await requestMeal(
    [{ type: 'text', text: recipePrompt(source) }],
    slot,
    'recipe',
    RECIPE_SYSTEM,
    RECIPE_SCHEMA,
  );

  // A yield of nought or one-and-a-half servings is a misread, and dividing by
  // it later would be worse than assuming a single serving.
  const claimed = Math.round(raw?.servings ?? 0);
  const servings = Number.isFinite(claimed) && claimed >= 1 && claimed <= 60 ? claimed : 1;

  return { ...analysis, servings, sourceUrl: source.url };
}

/**
 * Correct an analysis in plain words.
 *
 * The whole meal goes back with the correction because the change is rarely
 * isolated: "it was grilled, not fried" moves the fat, which moves the
 * calories and the score. Asking for a fresh reading of the corrected meal is
 * both simpler and more accurate than patching one number and hoping.
 */
export async function refineAnalysis(
  analysis: AnalysisResult,
  instruction: string,
  slot?: MealSlot,
): Promise<AnalysisResult> {
  const asLogged = analysis.items
    .map((item) => `- ${item.name}, ${item.portion || 'a portion'}${item.grams ? ` (${item.grams} g)` : ''}, ${Math.round(item.nutrients.calories)} kcal`)
    .join('\n');

  const { analysis: corrected } = await requestText(
    [
      {
        type: 'text',
        text: [
          `You previously read this ${slot ?? 'meal'} as "${analysis.title}":`,
          asLogged || '- (nothing)',
          '',
          `The person says: "${instruction}"`,
          '',
          'Apply their correction and return the whole meal again. They are telling you about the food, not asking a question — trust them over your own earlier reading. Leave anything they did not mention exactly as it was, including its portion and its nutrition. If they are adding a food, add it; if they are removing one, leave it out. Leave question and choices empty: they have told you what they know.',
        ].join('\n'),
      },
    ],
    slot,
  );
  // One question a meal, and this was the answer to it (or a correction that
  // makes it moot): never a second.
  const { clarify: _asked, ...answered } = corrected;
  return answered;
}

export interface CoachContext {
  name: string;
  goal: string;
  streak: number;
  caloriesEaten: number;
  caloriesTarget: number;
  protein: number;
  proteinTarget: number;
  fibre: number;
  water: number;
  waterTarget: number;
  mealsLogged: number;
  timeOfDay: string;
  recentMeals: string[];
  /** How they eat and what they want (src/lib/eating.ts): a nudge that suggests food respects the first and speaks to the second. */
  about?: About;
}

/** Short daily nudge in Squish's voice. */
export async function coachMessage(ctx: CoachContext): Promise<string> {
  return withModels('coach', (model, _attempt, signal) => coachOn(model, ctx, signal));
}

async function coachOn(model: string, ctx: CoachContext, signal: AbortSignal): Promise<string> {
  const response = await createMessage({
    model,
    max_tokens: 400,
    system:
      "You are Squish, a small round blob mascot who helps someone eat well. You speak in one or two short sentences, warm, playful and specific. Never shame food choices, never mention calories as something to 'burn off', never give medical advice. Reply with the message only — no quotes, no preamble.\n\n" +
      regionNote('coach'),
    // A line, not a problem to reason about: no thinking where the model allows it, and little effort where it takes one.
    ...(model.startsWith('claude-') && !model.startsWith('claude-haiku') ? { ...thinkingOff(model), output_config: { effort: 'low' as const } } : {}),
    messages: [
      {
        role: 'user',
        content: `Write today's nudge for ${ctx.name || 'my friend'}.
Their local time: ${String(ctx.timeOfDay ?? '').slice(0, 40)}
Goal: ${ctx.goal}
Streak: ${ctx.streak} days
Meals logged today: ${ctx.mealsLogged} (${ctx.recentMeals.join(', ') || 'nothing yet'})
Energy: ${Math.round(ctx.caloriesEaten)} of ${Math.round(ctx.caloriesTarget)} kcal
Protein: ${Math.round(ctx.protein)} of ${Math.round(ctx.proteinTarget)} g
Fibre so far: ${Math.round(ctx.fibre)} g
Water: ${ctx.water} of ${ctx.waterTarget} glasses
${[...eatingLines(ctx.about ?? {}), ...aimLines(ctx.about ?? {})].join('\n')}

Pick the one thing most worth mentioning right now and say it kindly. Fit it to the time given: no "good morning" in the evening, and late at night nothing that asks them to eat or drink more.`,
      },
    ],
  }, signal);

  billed(priceUsage(response.model, { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }), response.model);
  const nudge = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!nudge) throw new Error('The nudge came back empty.');
  return nudge;
}


/* ------------------------------------------------------------------ *
 * The nutritionist's weekly plan (server/weekplan.ts has the why).
 * ------------------------------------------------------------------ */

export interface PlannedDay {
  date: string;
  meals: AnalysisResult[];
  calories: number;
  /** Came back under the safety floor. Shown, never quietly passed on. */
  underFloor: boolean;
}

export interface WeekPlan {
  summary: string;
  days: PlannedDay[];
}

export class WeekPlanError extends Error {}

interface ModelWeek {
  summary?: string;
  days?: { day?: number; meals?: (ModelMeal & { slot?: MealSlot })[] }[];
}

const addDaysIso = (iso: string, delta: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return date.toISOString().slice(0, 10);
};

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * The model's week, made into days the app can plan with: each day once, in
 * order, within the days asked for, its meals in meal order and shaped like
 * any other analysis. Exported for the tests, which never call the API.
 */
export function toWeekPlan(parsed: ModelWeek, req: WeekPlanRequest): WeekPlan {
  const floor = floorFor(req.sex);
  const seen = new Set<number>();
  const days = (parsed.days ?? [])
    .filter((d) => Number.isInteger(d.day) && d.day! >= 1 && d.day! <= req.days && !seen.has(d.day!) && seen.add(d.day!))
    .sort((a, b) => a.day! - b.day!)
    .map((d) => {
      const meals = (d.meals ?? [])
        .filter((m) => m.slot && SLOT_ORDER.includes(m.slot) && (m.items ?? []).length > 0)
        .map((m) => ({ ...toAnalysis({ ...m, score: undefined }, m.slot), slot: m.slot }))
        .sort((a, b) => SLOT_ORDER.indexOf(a.slot!) - SLOT_ORDER.indexOf(b.slot!));
      const calories = Math.round(meals.reduce((sum, m) => sum + m.nutrients.calories, 0));
      return { date: addDaysIso(req.startDate, d.day! - 1), meals, calories, underFloor: calories < floor };
    })
    .filter((d) => d.meals.length > 0);
  return { summary: parsed.summary?.trim() ?? '', days };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Every figure in a set of nutrients times a factor; whatever nobody said stays unsaid. */
function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(n)) {
    if (key === 'micros' && value && typeof value === 'object') {
      out.micros = Object.fromEntries(Object.entries(value).map(([m, v]) => [m, typeof v === 'number' ? round1(v * factor) : v]));
    } else {
      out[key] = typeof value === 'number' ? (key === 'calories' ? Math.round(value * factor) : round1(value * factor)) : value;
    }
  }
  return out as unknown as Nutrients;
}

/** How far under the target a day may land before its portions are brought up to it, and the most they are scaled up by. */
export const FIT = { tolerance: 0.1, most: 1.5 };

/** A day's portions, grams and nutrition together, times a factor. */
function scaleDay(day: WeekPlan['days'][number], factor: number) {
  const meals = day.meals.map((meal) => ({
    ...meal,
    nutrients: scaleNutrients(meal.nutrients, factor),
    items: meal.items.map((item) => ({
      ...item,
      grams: item.grams === undefined ? undefined : Math.round(item.grams * factor),
      nutrients: scaleNutrients(item.nutrients, factor),
    })),
  }));
  return { meals, calories: Math.round(meals.reduce((sum, m) => sum + m.nutrients.calories, 0)) };
}

/**
 * Each day brought to the calorie target it was planned for, and never over it.
 *
 * The model is asked for days at or just under the target and told this step
 * does the rest, so it need not work the sums out to the calorie; and the
 * figures it gave are then replaced by the food table's (server/grounding.ts),
 * so a day can drift well away from it — a plan that says it is for 1,900 kcal
 * a day and adds up to 2,500 is no use to anybody. A day over the target, by
 * any amount, has every portion on it scaled down by the same factor, grams
 * and nutrition together, so the meals stay the meals and the day comes in at
 * the target. A day more than 10% under is scaled up to it the same way,
 * unless it would take more than one-and-a-half times: that is a bad plan,
 * not a rounding problem, and is shown as it came. Each meal's calories are
 * rounded on their own, so the factor is nudged down until the rounded day is
 * not a calorie over. Exported for the tests.
 */
export function fitToTarget(plan: WeekPlan, target: number, floor: number): { plan: WeekPlan; fitted: { date: string; from: number }[] } {
  const fitted: { date: string; from: number }[] = [];
  const days = plan.days.map((day) => {
    if (!day.calories || (day.calories <= target && day.calories >= target * (1 - FIT.tolerance))) return day;
    let factor = target / day.calories;
    if (factor > FIT.most) return day;
    let scaled = scaleDay(day, factor);
    for (let tries = 0; scaled.calories > target && tries < 50; tries++) {
      factor *= (target - 0.5) / scaled.calories;
      scaled = scaleDay(day, factor);
    }
    fitted.push({ date: day.date, from: day.calories });
    return { ...day, ...scaled, underFloor: scaled.calories < floor };
  });
  return { plan: { ...plan, days }, fitted };
}

/**
 * A week's ingredients checked against the food table in one pass, and — in
 * table-first mode — the named ones it could not answer filled in with one
 * question for the whole week, not one per meal.
 */
async function groundWeek(week: ModelWeek, brief: boolean): Promise<{ week: ModelWeek; fill: CallCost | null }> {
  const places: { day: number; meal: number; item: number }[] = [];
  const all: NonNullable<ModelMeal['items']> = [];
  (week.days ?? []).forEach((day, d) =>
    (day.meals ?? []).forEach((meal, m) =>
      (meal.items ?? []).forEach((item, i) => {
        places.push({ day: d, meal: m, item: i });
        all.push(item);
      }),
    ),
  );
  if (!all.length) return { week, fill: null };

  let items = (await groundMeal({ title: 'a week of planned meals', items: all })).items ?? all;
  let fill: CallCost | null = null;
  if (brief) {
    // Without vitamins and minerals, as the rest of a plan is.
    const done = await fillFigures({ title: 'a week of planned meals', items }, false);
    items = done.meal.items ?? items;
    fill = done.cost;
    const fromTable = items.filter((item) => item.source).length;
    console.info(`[squish] weekplan table first: ${fromTable} of ${items.length} ingredients from the table, ${done.filled} filled in`);
  }

  const days = structuredClone(week.days ?? []);
  places.forEach(({ day, meal, item }, n) => {
    days[day].meals![meal].items![item] = items[n];
  });
  return { week: { ...week, days }, fill };
}

/**
 * Ask for the week, on the 'weekplan' route. Streamed from Claude, because a
 * week of meals with thinking can run past a minute and a non-streamed
 * request that long risks a timeout; and on Claude with the server-side
 * fallback too, so a refusal on one model is retried on another inside the
 * same call before the route's own backup is asked.
 */
export function planWeek(req: WeekPlanRequest, signal?: AbortSignal): Promise<WeekPlan> {
  // The job's own stop and the time limit, in one signal for each attempt.
  return withModels('weekplan', (model, _attempt, attemptSignal) => planWeekOn(model, req, attemptSignal), { signal });
}

async function planWeekOn(model: string, req: WeekPlanRequest, signal: AbortSignal): Promise<WeekPlan> {
  const startedAt = Date.now();
  const plain = model.startsWith('claude-haiku') || model.startsWith('gemini-');
  // Table first, as for meals: an ingredient the table can answer carries only calories and free sugar.
  const brief = await tableFirst(WEEKPLAN_SYSTEM);
  const schema = (brief ? briefSchema(WEEKPLAN_SCHEMA as unknown as Record<string, unknown>) : WEEKPLAN_SCHEMA) as Record<string, unknown>;
  const format = { type: 'json_schema' as const, schema };
  const response = await streamMessage({
    model,
    // Thinking counts against this too. At 32,000 a week with its reasoning could be cut off
    // ("ran long") on Claude, and the route's backup asked every time; streamed, room costs nothing.
    max_tokens: 64000,
    system: `${WEEKPLAN_SYSTEM}${brief ? `\n${TABLE_FIRST_RULE}` : ''}\n\n${regionNote('plan')}`,
    messages: [{ role: 'user', content: weekPlanPrompt(req) }],
    ...(plain
      ? { output_config: { format } }
      : {
          thinking: { type: 'adaptive' as const },
          // Low, not medium: at medium, Opus and Sonnet thought for so long over a week that
          // they ran out of room or time and Gemini planned it instead. The sums need no deep
          // thought here — the food table supplies the figures and fitToTarget lands each day on
          // its target — so the reasoning went on arithmetic the server redoes anyway.
          output_config: { effort: 'low' as const, format },
          // Anthropic's own fallback for a declined plan, on Opus, where it was proven; on any
          // other model a decline fails over to the route's backup (server/routing.ts) instead.
          ...(model.startsWith('claude-opus') ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        }),
  }, signal);

  const usage = response.usage;
  const usd = billed(
    priceUsage(response.model, {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    }),
    response.model,
  );
  console.info(
    `[squish] weekplan model=${response.model} days=${req.days} in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `${usd === null ? 'unpriced' : `$${usd.toFixed(4)}`} ${((Date.now() - startedAt) / 1000).toFixed(1)}s stop=${response.stop_reason}`,
  );

  if (response.stop_reason === 'refusal') throw new WeekPlanError(msg('The nutritionist could not plan that week. Try different preferences.'));
  if (response.stop_reason === 'max_tokens') throw new WeekPlanError(msg('That plan ran long. Try fewer days, or without snacks.'));

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const { week, fill } = await groundWeek(readAnswer<ModelWeek>(text, response.stop_reason), brief);
  if (fill) console.info(`[squish] weekplan fill-in: out=${fill.outputTokens} ${fill.costUsd === null ? 'unpriced' : `$${fill.costUsd.toFixed(4)}`}`);
  const { plan, fitted } = fitToTarget(toWeekPlan(week, req), req.calorieTarget, floorFor(req.sex));
  if (fitted.length) {
    console.info(
      `[squish] weekplan ${model}: ${fitted.length} of ${plan.days.length} days came to ${fitted.map((f) => f.from).join(', ')} kcal ` +
        `against a ${req.calorieTarget} kcal target — portions scaled to it`,
    );
  }
  if (!plan.days.length) throw new WeekPlanError(msg('The plan came back empty. Try again in a moment.'));
  return plan;
}

/**
 * A batch of interface strings, translated. Not billed to anybody: the
 * interface is translated once for everyone, so its cost is the business's,
 * and is logged for the record.
 */
export function translateBatch(entries: CatalogEntry[], language: Pack): Promise<Record<string, unknown>> {
  // Too long is too long on any model: the batch is split rather than asked again whole.
  return withModels('translate', (model, _attempt, signal) => translateOn(model, entries, language, signal), {
    final: (error) => error instanceof TranslationTooLong,
  });
}

async function translateOn(model: string, entries: CatalogEntry[], language: Pack, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await createMessage(translateRequest(entries, language, model), signal);
  // Too long for one answer: the caller splits the batch and asks again.
  if (response.stop_reason === 'max_tokens') throw new TranslationTooLong(`translation of ${entries.length} strings into ${language} ran long`);
  if (response.stop_reason === 'refusal') throw new Error('translation stopped: refusal');
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const usd = priceUsage(response.model, { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
  console.log(`    Translated ${entries.length} strings into ${language}${usd === null ? '' : ` for $${usd.toFixed(3)}`}.`);
  return readTranslation(text);
}
