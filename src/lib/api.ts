import type { AnalysisResult, Clarify, CookSteps, MealEntry, MealSlot } from '../types';
import { demoEstimateFromPhoto, estimateFromText } from './estimate';
import { apiUrl } from './origin';
import { deviceToken, forgetDevice } from './identity';
import { showPaywall } from './paywall';
import { refreshPlan } from './plan';
import type { ToolAnswer, ToolCall } from './nutritionist-tools';
import { runConversation, type ChatContext, type ChatMessage, type ChatStep, type ConversationResult } from './nutritionist-session';
import { placeHeaders } from './place';
import { t } from './i18n';
import { isStepAction, type StepDetail } from './cooking';
import type { About } from './eating';
import type { Household, KeptMeal } from './planner';
import type { PlanHistory } from './planLearning';
import type { Heard } from './heard';

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

/**
 * Whether the paywall has already said what there is to say about this error.
 * Screens use it to stay quiet rather than repeat it as a toast underneath.
 */
export const isPaywalled = (error: unknown): boolean =>
  error instanceof SquishApiError && error.kind === 'out_of_allowance';

/** What the server says when an allowance has run out. */
export interface OutOfAllowance {
  plan: 'free' | 'plus';
  kind: 'photo' | 'chat' | 'recipe' | 'weekplan' | 'swap' | 'cook';
  used: number;
  allowance: number;
  /** 'month' for Plus; 'ever' for the free taste, which does not come back. */
  period?: 'month' | 'ever';
  /** Signed out on the free plan: an account would unlock `taste` of these. */
  needsAccount?: boolean;
  taste?: number;
  /** ISO date when the month rolls over and it comes back; null for the free taste. */
  resets: string | null;
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
    throw new SquishApiError('out_of_allowance', payload.message ? t(payload.message) : t("That is this month's allowance."), standing);
  }
  if (response.status === 429) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    // `message` is the sentence; `error` is a sentence on some routes and a
    // code ("rate_limited") on others, and a code is never for showing.
    const said = payload.message ?? (payload.error && /\s/.test(payload.error) ? payload.error : undefined);
    throw new SquishApiError('rate_limited', said ? t(said) : t('Too many in one hour — try again shortly.'));
  }
  if (!response.ok) {
    // The server explains itself in `error`, in words written to be read —
    // "that page does not look like a recipe" beats "502". When it says
    // nothing, the status code is all there is, and that is not for showing:
    // it stays an ordinary Error and each screen says its own thing instead.
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    // Translated on arrival: the server's messages are in the catalog too (marked with msg()).
    if (payload.error) throw new SquishApiError('server', t(payload.error));
    throw new Error(`${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * The headers every call carries: the device token, where the server issues
 * them (absent on a Squish with no database, and everything still works), and
 * which country they are in and which language they want, so the AI writes in
 * their words and units.
 */
async function headers(json: boolean): Promise<Record<string, string>> {
  const token = await deviceToken(apiUrl);
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...placeHeaders(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function post<T>(path: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

/**
 * Answer the AI's own question about a meal ("Was the dressing vinaigrette,
 * Caesar or olive oil?"). Free — the question was Squish's — and the meal
 * comes back re-read with the answer, with no second question.
 */
export async function answerQuestion(
  analysis: AnalysisResult,
  clarify: Clarify,
  choice: string,
  slot?: MealSlot,
): Promise<AnalysisResult> {
  return post<AnalysisResult>('/api/analyse/clarify', { analysis, clarify, choice, slot });
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

/** One planned day from the nutritionist: its meals, shaped like any analysis, and whether it came back light. */
export interface PlannedDay {
  date: string;
  meals: AnalysisResult[];
  calories: number;
  underFloor: boolean;
}

export interface WeekPlan {
  summary: string;
  days: PlannedDay[];
}

export interface WeekPlanAsk {
  startDate: string;
  days: number;
  slots: MealSlot[];
  snacks: boolean;
  calorieTarget: number;
  proteinTarget: number;
  fibreTarget: number;
  goal: string;
  sex: string;
  likes: string[];
  notes: string[];
  preferences: string;
  cooking: 'quick' | 'normal' | 'batch';
  /** How they eat and what they want, from the profile. */
  about: About;
  /** Meals already standing on those days — kept, or planned by them — for the plan to work around. */
  kept?: KeptMeal[];
  /** Who else eats what they cook, when that is anybody. */
  household?: Household;
  /** How their last plans went, once there is something to go on. */
  history?: PlanHistory;
}

/*
 * A week takes the nutritionist a while to think through — sometimes a few
 * minutes. Rather than hold one request open that long (the app used to give
 * up at two, after the plan had been paid for), the server starts the plan
 * and answers with a job, and the app asks after it every few seconds. The
 * job is remembered here too, so a plan asked for before the app was closed
 * is picked up when the planner is opened again.
 */

type WeekPlanJob = { status: 'working' } | { status: 'done'; plan: WeekPlan } | { status: 'failed'; error: string };

const JOB_KEY = 'squish-weekplan-job';
/** How long a remembered job is worth picking up: the server keeps it a day, but a plan is stale sooner. */
const JOB_KEEP_MS = 40 * 60_000;
/** How long one wait lasts before the app stops watching (the plan still arrives, for next time). */
const JOB_WAIT_MS = 35 * 60_000;
const JOB_POLL_MS = 3000;

function rememberJob(job: string): void {
  try {
    localStorage.setItem(JOB_KEY, JSON.stringify({ job, at: Date.now() }));
  } catch {
    /* private mode: the wait still works, it just is not picked up after a restart */
  }
}

function forgetJob(): void {
  try {
    localStorage.removeItem(JOB_KEY);
  } catch {
    /* nothing to forget */
  }
}

/**
 * A plan that has arrived, kept on this device until it is added or thrown
 * away on purpose. The server counts a plan as delivered the moment the app
 * fetches it; if the screen that asked for it had gone by then — a plan takes
 * minutes, and people wander off — or the preview was closed, the plan
 * arrived into nothing: made, paid for, and never seen. Kept here, the
 * planner shows it again the next time it opens, wherever it is opened from.
 */
const READY_KEY = 'squish-weekplan-ready';
/** A kept plan is worth offering for a week; after that its days are mostly gone. */
const READY_KEEP_MS = 7 * 24 * 60 * 60_000;

function keepReady(plan: WeekPlan, job: string | null = null): void {
  try {
    localStorage.setItem(READY_KEY, JSON.stringify({ plan, job, at: Date.now() }));
  } catch {
    /* private mode: it is shown now, just not kept for later */
  }
}

/** Plans added or thrown away here, by job: the server's copy of one is never offered again. */
const FINISHED_KEY = 'squish-weekplan-finished';

function finishedJobs(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(FINISHED_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function markFinished(job: string): void {
  try {
    localStorage.setItem(FINISHED_KEY, JSON.stringify([job, ...finishedJobs().filter((id) => id !== job)].slice(0, 20)));
  } catch {
    /* worst case it is offered again, and can be thrown away again */
  }
}

/** A plan that arrived and has not yet been added or discarded, if there is one. */
export function readyWeekPlan(): WeekPlan | null {
  try {
    const saved = JSON.parse(localStorage.getItem(READY_KEY) ?? 'null') as { plan?: WeekPlan; at?: number } | null;
    if (saved?.plan?.days?.length && typeof saved.at === 'number' && Date.now() - saved.at < READY_KEEP_MS) return saved.plan;
  } catch {
    /* unreadable: as good as none */
  }
  clearReadyWeekPlan();
  return null;
}

/** Added to the plans, or thrown away on purpose — here, and for the server's copy of it. */
export function clearReadyWeekPlan(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(READY_KEY) ?? 'null') as { job?: string | null } | null;
    if (saved?.job) markFinished(saved.job);
    localStorage.removeItem(READY_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * The latest plan the server made for this person in the last day, if it
 * never reached them — an app still running the version from before a
 * deploy collects a plan and loses it; so does a phone that dies as it
 * arrives. `alreadyAdded` says whether its meals are in the plans already,
 * for plans added before jobs were remembered here. Kept like any other
 * arrived plan, so it is not asked for twice.
 */
export async function latestWeekPlan(alreadyAdded: (plan: WeekPlan) => boolean): Promise<WeekPlan | null> {
  try {
    const { job, plan } = await get<{ job: string | null; plan: WeekPlan | null }>('/api/weekplan/latest');
    if (!job || !plan?.days?.length || finishedJobs().includes(job)) return null;
    if (alreadyAdded(plan)) {
      markFinished(job);
      return null;
    }
    keepReady(plan, job);
    return plan;
  } catch {
    return null;
  }
}

/** A plan asked for earlier and not yet seen, if there is one worth waiting for. */
export function pendingWeekPlan(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(JOB_KEY) ?? 'null') as { job?: string; at?: number } | null;
    if (saved?.job && typeof saved.at === 'number' && Date.now() - saved.at < JOB_KEEP_MS) return saved.job;
  } catch {
    /* unreadable: as good as none */
  }
  forgetJob();
  return null;
}

/**
 * Wait for a plan being made. A lost connection is waited out; the server
 * saying the plan failed (its question already given back) or is gone ends
 * the wait with its reason.
 */
export async function waitForWeekPlan(job: string): Promise<WeekPlan> {
  const until = Date.now() + JOB_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
    let answer: WeekPlanJob;
    try {
      answer = await get<WeekPlanJob>(`/api/weekplan/${encodeURIComponent(job)}`);
    } catch (error) {
      // The server answered and said no: this plan will not come.
      if (error instanceof SquishApiError) {
        forgetJob();
        throw error;
      }
      continue; // A dropped connection or a slow answer: ask again.
    }
    if (answer.status === 'done') {
      // Kept before anything else: whoever was waiting for it may be long gone.
      keepReady(answer.plan, job);
      forgetJob();
      void refreshPlan(); // one of the month's plans used
      return answer.plan;
    }
    if (answer.status === 'failed') {
      forgetJob();
      void refreshPlan(); // the question has been given back: show it
      throw new SquishApiError('server', t(answer.error));
    }
  }
  throw new Error(t('Your plan is taking a while. It will be here when you open the planner again.'));
}

/**
 * A plan asked for and not yet seen, according to the server: made while the
 * app was closed (or on another device), or still being made. Its job id, or
 * null. Anything going wrong is as good as none — the planner opens as usual.
 */
export async function waitingWeekPlan(): Promise<string | null> {
  try {
    const { job } = await get<{ job: string | null }>('/api/weekplan/waiting');
    return job ?? null;
  } catch {
    return null;
  }
}

/**
 * How to cook a planned meal (server/cook.ts). Plus; a free plan gets the
 * paywall. Written once per meal and kept on the server, so asking again for
 * the same meal costs nothing — the app keeps them on the plan as well.
 */
export async function cookSteps(meal: Pick<MealEntry, 'title' | 'slot' | 'items'>, servings = 1): Promise<CookSteps> {
  const items = meal.items.map((item) => ({ name: item.name, portion: item.portion, grams: item.grams, liquid: item.liquid }));
  const { steps } = await post<{ steps: CookSteps }>('/api/cook', { title: meal.title, slot: meal.slot, items, servings }, 60_000);
  return servings > 1 ? { ...steps, servings } : steps;
}

/**
 * New labels for steps written before they were labelled the way they are
 * now, in any language (server/cook.ts). Quiet: nothing is shown if it cannot
 * be done — no paywall, no error — and the steps are drawn as they were.
 */
export async function relabelCookSteps(steps: string[], items: { name: string }[]): Promise<StepDetail[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(apiUrl('/api/cook/labels'), {
      method: 'POST',
      headers: await headers(true),
      body: JSON.stringify({ steps, items: items.map((item) => item.name) }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const { detail } = (await response.json()) as { detail?: StepDetail[] };
    return Array.isArray(detail) && detail.length === steps.length && detail.every((d) => isStepAction(d?.action)) ? detail : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface SwapAsk {
  date: string;
  slot: MealSlot;
  title: string;
  calories: number;
  protein: number;
  dayMeals: string[];
  avoid: string[];
  goal: string;
  sex: string;
  notes: string[];
  about: About;
}

/**
 * Another meal in place of a planned one, sized to it (server/weekplan.ts).
 * Plus; a free plan gets the paywall. Nothing changes until they choose to
 * use it.
 */
export async function swapPlannedMeal(ask: SwapAsk): Promise<AnalysisResult> {
  return (await post<{ meal: AnalysisResult }>('/api/weekplan/swap', ask, 120_000)).meal;
}

export async function requestWeekPlan(ask: WeekPlanAsk): Promise<WeekPlan> {
  const started = await post<WeekPlan | { job: string }>('/api/weekplan', ask);
  // A server from before jobs answers with the plan itself.
  if (!('job' in started)) {
    keepReady(started);
    return started;
  }
  rememberJob(started.job);
  void refreshPlan(); // the question the plan spent
  return waitForWeekPlan(started.job);
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
  about: About;
}

export async function coachNudge(ctx: CoachRequest): Promise<string | null> {
  try {
    const { message } = await post<{ message: string | null }>('/api/coach', ctx);
    return message;
  } catch {
    return null;
  }
}

/** How they heard about Squish, from onboarding. Nothing waits on it and nothing breaks without it. */
export async function noteHeard(heard: Heard): Promise<void> {
  try {
    await post('/api/heard', { heard });
  } catch {
    /* a gap in a count, nothing more */
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
