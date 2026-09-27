/**
 * Google's Gemini: the wire, the prices and the schema dialect.
 *
 * **Privacy first.** The privacy policy tells people their meals go to
 * Anthropic. A person's data may only come here when server/routing.ts sends
 * it: an admin's own requests, on a route an admin chose, or — once the policy
 * names Google and SQUISH_GEMINI_FOR_EVERYONE is set — everybody's. The
 * benchmark (`npm run bench`) uses it on the owner's own photos.
 *
 * Nothing here knows about meals. server/providers.ts turns a request built
 * for Claude into one for Gemini and the answer back, so every feature asks
 * both in the same words and reads both answers the same way.
 *
 * Plain HTTPS to the Generative Language API rather than Google's SDK: one
 * request shape, no new dependency.
 *
 *   GEMINI_API_KEY    a key from Google AI Studio, on a paid (billed) project
 *                     — as Google's terms stood when this was written, the
 *                     free tier lets Google use what is sent to improve its
 *                     products; check the current terms before relying on it
 *   GEMINI_BASE_URL   optional, for a proxy or the tests' stand-in
 */
const BASE_URL = (): string => (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
const apiKey = (): string | undefined => process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

export const hasGeminiKey = (): boolean => Boolean(apiKey());
export const isGeminiModel = (model: string): boolean => model.startsWith('gemini-');

/**
 * The model to start with. Google retires models for new accounts as it
 * releases new ones — gemini-2.5-flash answered a new key in September 2026
 * with "no longer available to new users", naming this one instead — so it
 * is only a starting point: the dashboard's models card and --models choose any other.
 */
export const DEFAULT_GEMINI = 'gemini-3.8-flash';

/** USD per million tokens. Images count as input; thinking is billed as output. */
export interface GeminiRate {
  input: number;
  output: number;
  /** The last day (UTC) this rate applies; absent for the one that runs on. */
  until?: string;
}

/**
 * Prices, oldest first within a model, so a price that changes on a known
 * date changes here by itself. Prices move: check
 * https://ai.google.dev/pricing, and a model missing from here is measured
 * and logged with no cost rather than a guessed one.
 *
 * - gemini-2.5-*: as Google published them in 2025.
 * - gemini-3.8-flash: an introductory $0.75 / $3.75 until 31 December 2026,
 *   then $1.50 / $7.50 — as reported in September 2026 (OpenRouter and
 *   others); confirm against Google's own page.
 */
export const GEMINI_PRICING: Record<string, GeminiRate[]> = {
  'gemini-3.8-flash': [
    { input: 0.75, output: 3.75, until: '2026-12-31' },
    { input: 1.5, output: 7.5 },
  ],
  'gemini-2.5-flash': [{ input: 0.3, output: 2.5 }],
  'gemini-2.5-flash-lite': [{ input: 0.1, output: 0.4 }],
  'gemini-2.5-pro': [{ input: 1.25, output: 10 }],
};

/** The rate for a model on a day: the first whose `until` has not passed, or none on file. */
export function geminiRate(model: string, at = new Date()): GeminiRate | null {
  const day = at.toISOString().slice(0, 10);
  return GEMINI_PRICING[model]?.find((rate) => !rate.until || day <= rate.until) ?? null;
}

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

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

export interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string };
}

/** What a call cost, in dollars: thinking counted with the answer, as it is billed. */
export function priceGemini(model: string, usage: GeminiResponse['usageMetadata'], at = new Date()): number | null {
  const rate = geminiRate(model, at);
  if (!rate || !usage) return null;
  const input = usage.promptTokenCount ?? 0;
  const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return (input * rate.input + output * rate.output) / 1_000_000;
}

/** One generateContent call. A refusal or an error status is thrown with Google's reason. */
export async function geminiGenerate(model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<GeminiResponse> {
  const key = apiKey();
  if (!key) throw new Error('No GEMINI_API_KEY set.');
  const timeout = AbortSignal.timeout(300_000);
  const response = await fetch(`${BASE_URL()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${payload.error?.message ?? 'no explanation'}`);
  return payload;
}
