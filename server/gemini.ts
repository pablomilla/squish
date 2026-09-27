/**
 * Google's Gemini, for the benchmark only.
 *
 * **Never for anybody but the people running Squish.** The privacy policy
 * tells people their photos go to Anthropic and nobody else, so a person's
 * photo may only come here if they are an admin trying it on their own meals
 * (server/modelTrial.ts decides, and a test holds the app to it), or through
 * `npm run bench`: the owner's own photos of weighed meals, read by Gemini
 * and by Claude side by side, to find out whether it is as good and what it
 * costs.
 *
 * Like for like: the same instructions (`mealSystem`), the same words with
 * the photo (`photoPrompt`), the same answer shape (MEAL_SCHEMA, turned into
 * the schema dialect Gemini takes) and the same parsing (`toAnalysis`). The
 * only thing that differs is the model.
 *
 * Plain HTTPS to the Generative Language API rather than Google's SDK: one
 * request shape, no new dependency for a benchmark.
 *
 *   GEMINI_API_KEY    a key from Google AI Studio, on a paid (billed) project
 *                     — as Google's terms stood when this was written, the
 *                     free tier lets Google use what is sent to improve its
 *                     products; check the current terms before relying on it
 *   GEMINI_BASE_URL   optional, for a proxy or the tests' stand-in
 */
import type { MealSlot } from '../src/types';
import { groundMeal } from './grounding';
import { bill } from './billing';
import {
  briefSchema,
  fillFigures,
  MEAL_SCHEMA,
  mealSystem,
  photoPrompt,
  SYSTEM,
  tableFirst,
  toAnalysis,
  type Crockery,
  type DetailedAnalysis,
  type ModelMeal,
} from './claude';

const BASE_URL = (): string => (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
const apiKey = (): string | undefined => process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

export const hasGeminiKey = (): boolean => Boolean(apiKey());
export const isGeminiModel = (model: string): boolean => model.startsWith('gemini-');

/**
 * USD per million tokens, as Google published them in 2025 — prices move,
 * so check https://ai.google.dev/pricing before trusting the cost column.
 * Images are billed as input tokens; thinking is billed as output. A model
 * missing from here is benchmarked but shows no cost.
 */
export const GEMINI_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
};

/**
 * MEAL_SCHEMA in Gemini's dialect: an OpenAPI subset with upper-case type
 * names, no `additionalProperties` (which it rejects), and `format: "enum"`
 * beside a list of allowed values. Everything else — properties, required,
 * items, description — carries across as it is.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'additionalProperties') continue;
    // Nothing required is the same as no list; an empty one is left out.
    if (key === 'required' && Array.isArray(value) && !value.length) continue;
    if (key === 'type' && typeof value === 'string') out.type = value.toUpperCase();
    else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, toGeminiSchema(inner)]));
    } else if (key === 'items') out.items = toGeminiSchema(value);
    else out[key] = value;
  }
  // A string with fixed values is spelled with a format as well as the list.
  if (out.type === 'STRING' && Array.isArray(out.enum)) out.format = 'enum';
  return out;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string };
}

/** What a call cost, in dollars: thinking counted with the answer, as it is billed. */
export function priceGemini(model: string, usage: GeminiResponse['usageMetadata']): number | null {
  const rate = GEMINI_PRICING[model];
  if (!rate || !usage) return null;
  const input = usage.promptTokenCount ?? 0;
  const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return (input * rate.input + output * rate.output) / 1_000_000;
}

/** A meal photo, read by Gemini: the same shape `analysePhotoDetailed` returns, for the benchmark. */
export async function analysePhotoGemini(
  imageBase64: string,
  mediaType: string,
  slot?: MealSlot,
  hint?: string,
  model = 'gemini-2.5-flash',
  crockery?: Crockery,
): Promise<DetailedAnalysis> {
  const key = apiKey();
  if (!key) throw new Error('No GEMINI_API_KEY set.');

  const startedAt = Date.now();
  // Table first, as Claude is asked: a food the table can answer carries only calories and free sugar.
  const brief = await tableFirst(SYSTEM);
  const response = await fetch(`${BASE_URL()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: mealSystem(brief) }] },
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: photoPrompt(slot, hint, crockery) }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(brief ? briefSchema(MEAL_SCHEMA) : MEAL_SCHEMA),
        // Room for thinking and the answer, as the Claude side has.
        maxOutputTokens: 8000,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const latencyMs = Date.now() - startedAt;

  const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${payload.error?.message ?? 'no explanation'}`);
  if (payload.promptFeedback?.blockReason) throw new Error(`Gemini declined the photo (${payload.promptFeedback.blockReason}).`);

  const candidate = payload.candidates?.[0];
  if (!candidate) throw new Error('Gemini returned no answer.');
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error(`Gemini stopped early (${candidate.finishReason}).`);
  }
  const text = (candidate.content?.parts ?? [])
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('');

  const usage = payload.usageMetadata ?? {};
  const costUsd = priceGemini(model, usage);
  // Counted against whoever asked, as a Claude reading is (nothing outside a request).
  bill(costUsd);

  // Checked against the food table as Claude's readings are, so the two are compared like for like;
  // named foods the table cannot answer are filled in by the same short text question (no photo).
  let meal = await groundMeal(JSON.parse(text) as ModelMeal);
  const fill = brief ? await fillFigures(meal) : null;
  if (fill) meal = fill.meal;

  return {
    analysis: toAnalysis(meal, slot),
    usage: {
      model: payload.modelVersion ?? model,
      inputTokens: (usage.promptTokenCount ?? 0) + (fill?.cost?.inputTokens ?? 0),
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) + (fill?.cost?.outputTokens ?? 0),
      cacheReadTokens: 0,
      costUsd: costUsd === null ? null : costUsd + (fill?.cost?.costUsd ?? 0),
      latencyMs: latencyMs + (fill?.cost?.latencyMs ?? 0),
    },
  };
}
