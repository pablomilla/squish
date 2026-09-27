/**
 * What a model call costs, whichever company's model it was.
 *
 * Prices are USD per million tokens, used to measure — to record what each
 * call cost and show it on the dashboard — never to bill anybody. A model
 * with no price here is measured and logged with no cost rather than a
 * guessed one, and cannot be chosen on the dashboard.
 */
import { GEMINI_PRICING, geminiRate, isGeminiModel } from './gemini';

/** Anthropic's list prices. */
const CLAUDE_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-fable-5-1': { input: 10, output: 50 },
};

/**
 * Cached tokens are not free, and they are not full price either.
 *
 * A read costs a tenth of an ordinary input token and a write costs a quarter
 * more than one, and `input_tokens` counts neither — so a priced run that
 * ignores them under-reports exactly when caching is doing its job, which is
 * the moment you most want the number to be right. (Only Claude's requests
 * are cached by Squish; Gemini's counts come back with none.)
 */
const CACHE_READ = 0.1;
const CACHE_WRITE = 1.25;

export interface TokenCounts {
  inputTokens: number;
  /** Including thinking, which every provider bills as output. */
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** A model's rate today, or none on file. A dated snapshot is priced as its model. */
export function rateFor(model: string, at = new Date()): { input: number; output: number } | null {
  const name = model.replace(/-\d{8}$/, '');
  if (isGeminiModel(name)) return geminiRate(name, at);
  return CLAUDE_PRICING[name] ?? null;
}

/** What a call cost, in dollars, or null for a model with no price on file. */
export function priceUsage(model: string, counts: TokenCounts): number | null {
  const rate = rateFor(model);
  if (!rate) return null;
  const input =
    counts.inputTokens +
    (counts.cacheReadTokens ?? 0) * CACHE_READ +
    (counts.cacheWriteTokens ?? 0) * CACHE_WRITE;
  return (input * rate.input + counts.outputTokens * rate.output) / 1_000_000;
}

/** Every model with a price on file: the ones the dashboard offers. */
export const PRICED_MODELS: string[] = [...Object.keys(CLAUDE_PRICING), ...Object.keys(GEMINI_PRICING)];
