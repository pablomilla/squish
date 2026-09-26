/**
 * Claude-powered meal analysis.
 *
 * Vision + structured outputs: the model looks at the photo (or reads the
 * description) and returns JSON that matches MEAL_SCHEMA exactly, so the app
 * never has to parse prose into numbers.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisResult, MealSlot, Micros, Nutrients } from '../src/types';
import { MICROS } from '../src/types';
import { addMicros, addOptional, qualityScore, ultraProcessedShare } from '../src/lib/nutrition';
import { RECIPE_SYSTEM, recipePrompt, type RecipeImport, type RecipeSource } from './recipe';
import { bill } from './billing';
import { regionNote } from './region';
import { isAisle } from '../src/lib/shopping';
import { WEEKPLAN_SCHEMA, WEEKPLAN_SYSTEM, floorFor, weekPlanPrompt, type WeekPlanRequest } from './weekplan';

const MODEL = process.env.SQUISH_MODEL ?? 'claude-opus-5';

/** USD per million tokens. Used to price a run, not to bill anyone. */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-fable-5-1': { input: 10, output: 50 },
};

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

let client: Anthropic | null = null;

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

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
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

const MEAL_SCHEMA = {
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
          nutrients: {
            type: 'object',
            properties: NUTRIENT_PROPS,
            required: ['calories', 'protein', 'carbs', 'fat', 'fibre', 'satFat', 'sugar', 'freeSugar', 'sodium', 'micros'],
            additionalProperties: false,
          },
        },
        required: ['name', 'emoji', 'portion', 'grams', 'liquid', 'ultraProcessed', 'nutrients'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'slot', 'confidence', 'score', 'coachNote', 'items'],
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
- confidence is "low" when the photo is blurry, partly hidden, or the dish could be made many ways.
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

interface ModelMeal {
  /** Recipes only: how many servings the whole thing makes. */
  servings?: number;
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
    /** Weekly plans only. */
    aisle?: string;
    nutrients?: Partial<Nutrients>;
  }[];
}

function toAnalysis(parsed: ModelMeal, fallbackSlot?: MealSlot): AnalysisResult {
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
  };
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
  if (model.startsWith('claude-haiku')) {
    return { output_config: { format } };
  }
  return {
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format },
  };
}

/**
 * Cached tokens are not free, and they are not full price either.
 *
 * A read costs a tenth of an ordinary input token and a write costs a quarter
 * more than one, and `input_tokens` counts neither — so a priced run that
 * ignores them under-reports exactly when caching is doing its job, which is
 * the moment you most want the number to be right.
 */
const CACHE_READ = 0.1;
const CACHE_WRITE = 1.25;

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** What a call cost, in dollars, or null for a model with no price on file. */
/** Charge a price to whoever is being served, and hand it straight back. */
function billed(usd: number | null): number | null {
  bill(usd);
  return usd;
}

export function priceUsage(model: string, counts: TokenCounts): number | null {
  const rate = PRICING[model];
  if (!rate) return null;
  const input =
    counts.inputTokens +
    (counts.cacheReadTokens ?? 0) * CACHE_READ +
    (counts.cacheWriteTokens ?? 0) * CACHE_WRITE;
  return (input * rate.input + counts.outputTokens * rate.output) / 1_000_000;
}

async function requestMeal(
  content: Anthropic.ContentBlockParam[],
  fallbackSlot?: MealSlot,
  model: string = MODEL,
  system: string = SYSTEM,
  schema: Record<string, unknown> = MEAL_SCHEMA,
): Promise<DetailedAnalysis> {
  const startedAt = Date.now();
  const response = await getClient().messages.create({
    model,
    max_tokens: 8000,
    // Where they live goes last, after the rules every country shares.
    system: `${system}\n\n${regionNote(system === LABEL_SYSTEM ? 'label' : system === RECIPE_SYSTEM ? 'recipe' : 'meal')}`,
    messages: [{ role: 'user', content }],
    ...tuningFor(model, schema),
  });
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

  const parsed = JSON.parse(text) as ModelMeal;

  return {
    analysis: toAnalysis(parsed, fallbackSlot),
    raw: parsed,
    usage: {
      model: response.model,
      inputTokens,
      outputTokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      costUsd: billed(
        priceUsage(model, {
          inputTokens,
          outputTokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        }),
      ),
      latencyMs,
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

export async function analysePhotoDetailed(
  imageBase64: string,
  mediaType: string,
  slot?: MealSlot,
  hint?: string,
  model: string = MODEL,
  crockery?: Crockery,
): Promise<DetailedAnalysis> {
  return requestMeal(
    [
      { type: 'image', source: { type: 'base64', media_type: asMedia(mediaType), data: imageBase64 } },
      {
        type: 'text',
        text: [
          `This is a photo of a ${slot ?? 'meal'} someone just ate or is about to eat.`,
          crockeryNote(crockery),
          hint ? `They added a note: "${hint}".` : '',
          'Identify every food and drink, estimate the portions from the visual cues, and return the nutrition.',
        ]
          .filter(Boolean)
          .join(' '),
      },
    ],
    slot,
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
    MODEL,
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
  const { analysis } = await analysePhotoDetailed(imageBase64, mediaType, slot, hint, MODEL, crockery);
  return analysis;
}

export async function analyseText(description: string, slot?: MealSlot): Promise<AnalysisResult> {
  const { analysis } = await requestMeal(
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
    MODEL,
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

  const { analysis: corrected } = await requestMeal(
    [
      {
        type: 'text',
        text: [
          `You previously read this ${slot ?? 'meal'} as "${analysis.title}":`,
          asLogged || '- (nothing)',
          '',
          `The person says: "${instruction}"`,
          '',
          'Apply their correction and return the whole meal again. They are telling you about the food, not asking a question — trust them over your own earlier reading. Leave anything they did not mention exactly as it was, including its portion and its nutrition. If they are adding a food, add it; if they are removing one, leave it out.',
        ].join('\n'),
      },
    ],
    slot,
  );
  return corrected;
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
}

/** Short daily nudge in Squish's voice. */
export async function coachMessage(ctx: CoachContext): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      "You are Squish, a small round blob mascot who helps someone eat well. You speak in one or two short sentences, warm, playful and specific. Never shame food choices, never mention calories as something to 'burn off', never give medical advice. Reply with the message only — no quotes, no preamble.\n\n" +
      regionNote('coach'),
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
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

Pick the one thing most worth mentioning right now and say it kindly. Fit it to the time given: no "good morning" in the evening, and late at night nothing that asks them to eat or drink more.`,
      },
    ],
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}


/* ------------------------------------------------------------------ *
 * The nutritionist's weekly plan (server/weekplan.ts has the why).
 * ------------------------------------------------------------------ */

const WEEKPLAN_MODEL = process.env.SQUISH_WEEKPLAN_MODEL ?? MODEL;

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

/**
 * Ask for the week. Streamed, because a week of meals with thinking can run
 * past a minute and a non-streamed request that long risks a timeout; and
 * with the server-side fallback, so a refusal on one model is retried on
 * another rather than handed back as an empty week.
 */
export async function planWeek(req: WeekPlanRequest): Promise<WeekPlan> {
  const startedAt = Date.now();
  const haiku = WEEKPLAN_MODEL.startsWith('claude-haiku');
  const format = { type: 'json_schema' as const, schema: WEEKPLAN_SCHEMA as unknown as Record<string, unknown> };
  const stream = getClient().beta.messages.stream({
    model: WEEKPLAN_MODEL,
    max_tokens: 32000,
    system: `${WEEKPLAN_SYSTEM}\n\n${regionNote('plan')}`,
    messages: [{ role: 'user', content: weekPlanPrompt(req) }],
    ...(haiku
      ? { output_config: { format } }
      : {
          thinking: { type: 'adaptive' as const },
          output_config: { effort: 'medium' as const, format },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default' as const,
        }),
  });
  const response = await stream.finalMessage();

  const usage = response.usage;
  const usd = billed(
    priceUsage(response.model, {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    }),
  );
  console.info(
    `[squish] weekplan model=${response.model} days=${req.days} in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `${usd === null ? 'unpriced' : `$${usd.toFixed(4)}`} ${((Date.now() - startedAt) / 1000).toFixed(1)}s stop=${response.stop_reason}`,
  );

  if (response.stop_reason === 'refusal') throw new WeekPlanError('The nutritionist could not plan that week. Try different preferences.');
  if (response.stop_reason === 'max_tokens') throw new WeekPlanError('That plan ran long. Try fewer days, or without snacks.');

  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const plan = toWeekPlan(JSON.parse(text) as ModelWeek, req);
  if (!plan.days.length) throw new WeekPlanError('The plan came back empty. Try again in a moment.');
  return plan;
}
