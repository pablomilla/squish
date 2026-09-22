import type { AnalysisResult, MealSlot } from '../types';
import { demoEstimateFromPhoto, estimateFromText } from './estimate';
import { apiUrl } from './origin';
import { deviceToken, forgetDevice } from './identity';
import { showPaywall } from './paywall';
import { refreshPlan } from './plan';
import type { ToolAnswer, ToolCall } from './nutritionist-tools';
import { runConversation, type ChatContext, type ChatMessage, type ChatStep, type ConversationResult } from './nutritionist-session';

const TIMEOUT_MS = 45_000;

/**
 * Errors the user needs to see rather than silently absorb.
 *
 * A request refused for want of allowance must not quietly turn into an
 * offline estimate — that would look like a working analysis, and somebody
 * would go on believing the numbers.
 */
export class SquishApiError extends Error {
  kind: 'out_of_allowance' | 'rate_limited' | 'server';

  /** Present on `out_of_allowance`: what the app needs to show a paywall. */
  standing?: OutOfAllowance;

  constructor(kind: SquishApiError['kind'], message: string, standing?: OutOfAllowance) {
    super(message);
    this.name = 'SquishApiError';
    this.kind = kind;
    this.standing = standing;
  }
}

/** What the server says when an allowance has run out. */
export interface OutOfAllowance {
  plan: 'free' | 'plus';
  kind: 'photo' | 'chat' | 'recipe';
  used: number;
  allowance: number;
  /** ISO date when the month rolls over and it comes back. */
  resets: string;
  message: string;
}


async function unwrap<T>(path: string, response: Response): Promise<T> {
  // 402: the month's allowance is gone. Not an error in the app's sense — the
  // request was understood and refused — so it carries everything a paywall
  // needs rather than just a sentence.
  if (response.status === 402) {
    const payload = (await response.json().catch(() => ({}))) as Partial<OutOfAllowance>;
    const standing = payload as OutOfAllowance;
    // Raised here, once, so no screen has to remember to. Every caller still
    // gets the throw and can say its own thing as well.
    showPaywall(standing);
    void refreshPlan();
    throw new SquishApiError('out_of_allowance', payload.message ?? "That is this month's allowance.", standing);
  }
  if (response.status === 429) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new SquishApiError('rate_limited', payload.error ?? payload.message ?? 'Too many in one hour — try again shortly.');
  }
  if (!response.ok) {
    // The server explains itself in `error`, in words written to be read —
    // "that page does not look like a recipe" beats "502". When it says
    // nothing, the status code is all there is, and that is not for showing:
    // it stays an ordinary Error and each screen says its own thing instead.
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (payload.error) throw new SquishApiError('server', payload.error);
    throw new Error(`${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * The headers every call carries: the device token, where the server issues
 * them. Absent on a Squish with no database, and everything still works.
 */
async function headers(json: boolean): Promise<Record<string, string>> {
  const token = await deviceToken(apiUrl);
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await unwrap<T>(
      path,
      await fetch(apiUrl(path), {
        method: 'POST',
        headers: await headers(true),
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function get<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await unwrap<T>(
      path,
      await fetch(apiUrl(path), { headers: await headers(false), signal: controller.signal }),
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface AiStatus {
  ok: boolean;
  ai: boolean;
  model: string;
  /** True when the server has a database — so backups and accounts exist. */
  accounts?: boolean;
}

/** Generous: a sleeping free-tier host can take the best part of a minute to wake. */
const HEALTH_TIMEOUT_MS = 90_000;

export async function aiStatus(): Promise<AiStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl('/api/health'), { signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as AiStatus;
  } catch {
    // Unreachable or too slow — let the app open anyway. Squish works offline,
    // and a server that comes back will be asked again when the tab does.
    return { ok: false, ai: false, model: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/** Analyse a meal photo. Falls back to a local estimate if the API is unreachable. */
/** Look a scanned barcode up. No offline answer exists, so it may fail. */
export async function lookupBarcode(code: string, slot?: MealSlot): Promise<AnalysisResult> {
  const query = slot ? `?slot=${encodeURIComponent(slot)}` : '';
  return get<AnalysisResult>(`/api/barcode/${encodeURIComponent(code)}${query}`);
}

export type PhotoMode = 'plate' | 'label';

export async function analysePhoto(
  dataUrl: string,
  slot?: MealSlot,
  hint?: string,
  mode: PhotoMode = 'plate',
  crockery?: { plateCm?: number; bowlMl?: number },
): Promise<AnalysisResult> {
  try {
    return await post<AnalysisResult>('/api/analyse/photo', { image: dataUrl, slot, hint, mode, crockery });
  } catch (error) {
    if (error instanceof SquishApiError) throw error;
    // Inventing a plate is a fair demo; inventing figures off a packet is not,
    // so a label read is allowed to fail and say so.
    if (mode === 'label') throw error;
    return demoEstimateFromPhoto(dataUrl.slice(-256), slot);
  }
}

/**
 * Hand a correction back to Squish in the person's own words.
 *
 * Unlike the analysers there is no offline fallback: guessing at "half the
 * rice" without a model would be worse than admitting it cannot be done, and
 * quietly returning the same meal would look like the correction was ignored.
 */
export async function refineAnalysis(
  analysis: AnalysisResult,
  instruction: string,
  slot?: MealSlot,
): Promise<AnalysisResult> {
  return post<AnalysisResult>('/api/analyse/refine', { analysis, instruction, slot });
}

/** Analyse a written meal description. */
export async function analyseText(description: string, slot?: MealSlot): Promise<AnalysisResult> {
  try {
    return await post<AnalysisResult>('/api/analyse/text', { description, slot });
  } catch (error) {
    if (error instanceof SquishApiError) throw error;
    return estimateFromText(description, slot);
  }
}

export interface RecipeImport extends AnalysisResult {
  /** How many servings the whole recipe makes. */
  servings: number;
  sourceUrl: string;
}

/**
 * One serving of a recipe from a web page.
 *
 * No offline fallback on purpose. Everywhere else, a failed call falls back to
 * the local estimator — but the estimator cannot read a web page, and handing
 * back a plausible invention under the title of somebody's recipe would be the
 * worst thing this app could do.
 */
export async function importRecipe(url: string, slot?: MealSlot): Promise<RecipeImport> {
  return post<RecipeImport>('/api/recipe', { url, slot });
}

/**
 * Asking the nutritionist, over the wire.
 *
 * The conversation and the loop are `nutritionist-session`; all that happens
 * here is the round trip. Keeping the loop out of this file is what lets an
 * eval, or a test, hold the same conversation without a browser.
 */
export type { ChatContext, ChatMessage, ChatStep } from './nutritionist-session';
export { MAX_TOOL_ROUNDS } from './nutritionist-session';

/** One round trip: a question in, an answer or a list of lookups out. */
export async function chatStep(
  messages: ChatMessage[],
  context: ChatContext,
  notes: { id: string; note: string }[],
): Promise<ChatStep> {
  return post<ChatStep>('/api/chat', { turns: messages, context, notes });
}

export type AskResult = ConversationResult;

/** Ask the nutritionist, running its lookups against the store in this browser. */
export async function askNutritionist(options: {
  messages: ChatMessage[];
  context: ChatContext;
  notes: () => { id: string; note: string }[];
  run: (call: ToolCall) => ToolAnswer;
  onLookup?: (labels: string[]) => void;
}): Promise<AskResult> {
  return runConversation({ ...options, step: chatStep });
}

export interface Allowance {
  known: boolean;
  account?: boolean;
  left?: Record<string, number>;
  daily?: Record<string, number>;
}

/**
 * What is left today — and a check that this browser is still who it thinks.
 *
 * The second part is the one that matters. A token from a database that has
 * since been replaced is not rejected anywhere: the server simply does not
 * recognise it and treats the request as anonymous, for ever, silently. Here
 * is where that becomes visible — if we are holding a token and the server
 * says it knows nobody, the token is stale, so it goes and the next call gets
 * a new one.
 */
export async function allowance(): Promise<Allowance> {
  try {
    const held = await deviceToken(apiUrl);
    const found = await get<Allowance>('/api/allowance');
    if (held && !found.known) forgetDevice();
    return found;
  } catch {
    return { known: false };
  }
}

export interface CoachRequest {
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

export async function coachNudge(ctx: CoachRequest): Promise<string | null> {
  try {
    const { message } = await post<{ message: string | null }>('/api/coach', ctx);
    return message;
  } catch {
    return null;
  }
}

/** Downscale a captured photo before it travels anywhere. */
/**
 * Three sizes, for three jobs.
 *
 * ANALYSIS goes to Claude and is never stored: recognising what is on a plate
 * wants the detail, and it costs nothing to keep afterwards because we do not.
 *
 * DISPLAY is what gets kept in IndexedDB and shown at 210px tall. A phone at
 * three times pixel density wants about 1170px across for that; 700 is a
 * compromise that looks right and is a fifth of the bytes.
 *
 * THUMB is what goes in the diary itself and therefore into the backup, shown
 * at 46 square. At about six kilobytes, a thousand meals still fit inside the
 * six-megabyte backup — where the old full-size photo managed nineteen.
 */
export const ANALYSIS = { maxSide: 1024, quality: 0.82 } as const;
export const DISPLAY = { maxSide: 700, quality: 0.72 } as const;
export const THUMB = { maxSide: 128, quality: 0.65 } as const;

export function shrinkImage(file: Blob, maxSide = 1024, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas is unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read'));
    };
    img.src = url;
  });
}

/**
 * Shrink something that is already a data URL.
 *
 * Used to make the display copy and the thumbnail out of the image that was
 * sent for analysis, rather than reading the original file three times.
 */
export function reshrink(dataUrl: string, maxSide: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas is unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('That image could not be read'));
    img.src = dataUrl;
  });
}
