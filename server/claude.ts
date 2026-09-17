/**
 * Claude-powered meal analysis.
 *
 * Vision + structured outputs: the model looks at the photo (or reads the
 * description) and returns JSON that matches MEAL_SCHEMA exactly, so the app
 * never has to parse prose into numbers.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisResult, MealSlot, Nutrients } from '../src/types';
import { qualityScore } from '../src/lib/nutrition';

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
  sugar: { type: 'number', description: 'grams of total sugars' },
  sodium: { type: 'number', description: 'milligrams' },
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
      description: 'Diet-quality score 0-100 for this meal: protein and fibre density lift it, heavy added sugar, saturated fat and sodium pull it down',
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
          portion: { type: 'string', description: 'Human-readable portion, e.g. "1 bowl (320 g)"' },
          grams: { type: 'number', description: 'Estimated edible weight in grams' },
          nutrients: {
            type: 'object',
            properties: NUTRIENT_PROPS,
            required: ['calories', 'protein', 'carbs', 'fat', 'fibre', 'sugar', 'sodium'],
            additionalProperties: false,
          },
        },
        required: ['name', 'emoji', 'portion', 'grams', 'nutrients'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'slot', 'confidence', 'score', 'coachNote', 'items'],
  additionalProperties: false,
} as const;

const SYSTEM = `You are the nutrition engine behind Squish, a friendly food-tracking app.

Your job is to identify what someone ate and estimate its nutrition as accurately as a careful dietitian would.

Rules:
- Estimate realistic portions from visual cues: plate and bowl size, cutlery, hands, packaging. Say so in the portion text.
- Break the meal into the individual foods you can actually see or that were described. Do not invent sides that are not there.
- Nutrition values are per the portion you state, not per 100 g.
- Count fibre inside total carbohydrate, and give sugar as total sugars.
- If the image is not food at all, return an empty items array, a score of 0, and say so kindly in coachNote.
- confidence is "low" when the photo is blurry, partly hidden, or the dish could be made many ways.
- coachNote is written in Squish's voice: warm, playful, encouraging, never moralising about "bad" food, British English.`;

function coerceNutrients(raw: Partial<Nutrients> | undefined): Nutrients {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
  return {
    calories: Math.round(num(raw?.calories)),
    protein: num(raw?.protein),
    carbs: num(raw?.carbs),
    fat: num(raw?.fat),
    fibre: num(raw?.fibre),
    sugar: num(raw?.sugar),
    sodium: Math.round(num(raw?.sodium)),
  };
}

interface ModelMeal {
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
    nutrients: coerceNutrients(item.nutrients),
  }));

  const nutrients = items.reduce<Nutrients>(
    (acc, item) => ({
      calories: acc.calories + item.nutrients.calories,
      protein: acc.protein + item.nutrients.protein,
      carbs: acc.carbs + item.nutrients.carbs,
      fat: acc.fat + item.nutrients.fat,
      fibre: acc.fibre + item.nutrients.fibre,
      sugar: (acc.sugar ?? 0) + (item.nutrients.sugar ?? 0),
      sodium: (acc.sodium ?? 0) + (item.nutrients.sodium ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0, sodium: 0 },
  );

  const score =
    typeof parsed.score === 'number' && parsed.score > 0
      ? Math.max(0, Math.min(100, Math.round(parsed.score)))
      : qualityScore(nutrients);

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
function tuningFor(model: string): Pick<Anthropic.MessageCreateParamsNonStreaming, 'thinking' | 'output_config'> {
  const format = { type: 'json_schema', schema: MEAL_SCHEMA } as const;
  if (model.startsWith('claude-haiku')) {
    return { output_config: { format } };
  }
  return {
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format },
  };
}

function priceOf(model: string, inputTokens: number, outputTokens: number): number | null {
  const rate = PRICING[model];
  if (!rate) return null;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

async function requestMeal(
  content: Anthropic.ContentBlockParam[],
  fallbackSlot?: MealSlot,
  model: string = MODEL,
): Promise<DetailedAnalysis> {
  const startedAt = Date.now();
  const response = await getClient().messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    ...tuningFor(model),
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

  return {
    analysis: toAnalysis(JSON.parse(text) as ModelMeal, fallbackSlot),
    usage: {
      model: response.model,
      inputTokens,
      outputTokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      costUsd: priceOf(model, inputTokens, outputTokens),
      latencyMs,
    },
  };
}

/** Full result including what the call cost — used by the benchmark. */
export async function analysePhotoDetailed(
  imageBase64: string,
  mediaType: string,
  slot?: MealSlot,
  hint?: string,
  model: string = MODEL,
): Promise<DetailedAnalysis> {
  const supported = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const media = (supported.includes(mediaType) ? mediaType : 'image/jpeg') as
    | 'image/jpeg'
    | 'image/png'
    | 'image/webp'
    | 'image/gif';

  return requestMeal(
    [
      { type: 'image', source: { type: 'base64', media_type: media, data: imageBase64 } },
      {
        type: 'text',
        text: [
          `This is a photo of a ${slot ?? 'meal'} someone just ate or is about to eat.`,
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

export async function analysePhoto(
  imageBase64: string,
  mediaType: string,
  slot?: MealSlot,
  hint?: string,
): Promise<AnalysisResult> {
  const { analysis } = await analysePhotoDetailed(imageBase64, mediaType, slot, hint);
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
      "You are Squish, a small round blob mascot who helps someone eat well. You speak in one or two short sentences, warm, playful and specific. British English. Never shame food choices, never mention calories as something to 'burn off', never give medical advice. Reply with the message only — no quotes, no preamble.",
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: `Write today's nudge for ${ctx.name || 'my friend'}.
Time of day: ${ctx.timeOfDay}
Goal: ${ctx.goal}
Streak: ${ctx.streak} days
Meals logged today: ${ctx.mealsLogged} (${ctx.recentMeals.join(', ') || 'nothing yet'})
Energy: ${Math.round(ctx.caloriesEaten)} of ${Math.round(ctx.caloriesTarget)} kcal
Protein: ${Math.round(ctx.protein)} of ${Math.round(ctx.proteinTarget)} g
Fibre so far: ${Math.round(ctx.fibre)} g
Water: ${ctx.water} of ${ctx.waterTarget} glasses

Pick the one thing most worth mentioning right now and say it kindly.`,
      },
    ],
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}
