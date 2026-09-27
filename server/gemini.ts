/**
 * Google's Gemini: the wire, the prices and the schema dialect.
 *
 * **Privacy first.** The privacy policy names Google, through the paid Gemini
 * API only. A person's data may only come here when server/routing.ts sends
 * it: an admin's own requests, on a route an admin chose, or — once
 * SQUISH_GEMINI_FOR_EVERYONE is set — everybody's. The benchmark
 * (`npm run bench`) uses it on the owner's own photos.
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

/**
 * Gemini now and then gets stuck inside a structured answer, writing the same
 * character over and over — on Nutrition5k, a number followed by fourteen
 * thousand zeros — until it runs out of room. Streamed, that is caught within
 * a second of starting, rather than after paying for the whole runaway.
 */
export class GeminiRunaway extends Error {
  readonly repeated: string;
  constructor(repeated: string) {
    super(`Gemini got stuck repeating ${JSON.stringify(repeated)}`);
    this.repeated = repeated;
  }
}

/** Longer than any honest run in an answer: indentation is a few spaces, a number a few digits. */
const RUNAWAY = /(.)\1{199}$/s;

/**
 * One call, streamed (streamGenerateContent, as server-sent events), gathered
 * into the same response a single call returns. A body that is plain JSON —
 * one response, or a list of them — is read too, which is what the tests'
 * stand-ins send. A refusal or an error status is thrown with Google's reason.
 */
export async function geminiGenerate(model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<GeminiResponse> {
  const key = apiKey();
  if (!key) throw new Error('No GEMINI_API_KEY set.');
  const stop = new AbortController();
  const signals = [stop.signal, AbortSignal.timeout(300_000), ...(signal ? [signal] : [])];
  const response = await fetch(`${BASE_URL()}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.any(signals),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as GeminiResponse | GeminiResponse[];
    const error = Array.isArray(payload) ? payload[0]?.error : payload.error;
    throw new Error(`Gemini ${response.status}: ${error?.message ?? 'no explanation'}`);
  }

  const merged: GeminiResponse = {};
  let answer = '';
  const take = (chunk: GeminiResponse) => {
    if (chunk.error) throw new Error(`Gemini: ${chunk.error.message ?? 'no explanation'}`);
    if (chunk.promptFeedback) merged.promptFeedback = chunk.promptFeedback;
    if (chunk.usageMetadata) merged.usageMetadata = chunk.usageMetadata;
    if (chunk.modelVersion) merged.modelVersion = chunk.modelVersion;
    const candidate = chunk.candidates?.[0];
    if (!candidate) return;
    const into = ((merged.candidates ??= [{ content: { parts: [] } }])[0].content ??= { parts: [] });
    for (const part of candidate.content?.parts ?? []) {
      into.parts ??= [];
      const last = into.parts[into.parts.length - 1];
      // Text arrives in pieces: join each run of thinking or of answer back into one part.
      if (typeof part.text === 'string' && last && typeof last.text === 'string' && !last.functionCall && Boolean(last.thought) === Boolean(part.thought)) {
        last.text += part.text;
        if (part.thoughtSignature) last.thoughtSignature = part.thoughtSignature;
      } else {
        into.parts.push({ ...part });
      }
      if (typeof part.text === 'string' && !part.thought) {
        answer += part.text;
        const stuck = RUNAWAY.exec(answer.slice(-200));
        if (stuck) {
          stop.abort();
          throw new GeminiRunaway(stuck[1]);
        }
      }
    }
    if (candidate.finishReason) merged.candidates![0].finishReason = candidate.finishReason;
  };

  const raw = response.body ? response.body.getReader() : null;
  if (!raw) return merged;
  const decoder = new TextDecoder();
  let buffer = '';
  let plain = '';
  let sse = false;
  try {
    for (;;) {
      const { value, done } = await raw.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (!sse && !plain && /^\s*data:/.test(text)) sse = true;
      if (!sse) {
        plain += text;
        continue;
      }
      buffer += text;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line.startsWith('data:')) take(JSON.parse(line.slice(5)) as GeminiResponse);
      }
    }
  } finally {
    raw.releaseLock();
  }
  if (sse && buffer.trim().startsWith('data:')) take(JSON.parse(buffer.trim().slice(5)) as GeminiResponse);
  if (!sse && plain.trim()) {
    const parsed = JSON.parse(plain) as GeminiResponse | GeminiResponse[];
    for (const chunk of Array.isArray(parsed) ? parsed : [parsed]) take(chunk);
  }
  return merged;
}
