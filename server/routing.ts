/**
 * Which model does each job, and what takes over when it fails.
 *
 * Every AI feature has a route: a chain of up to three models, tried in
 * order. The first is the one that does the work; the others are backups,
 * asked only when the one before has failed — an outage, an overload, a
 * refusal, an answer that would not parse. One company's bad hour then costs
 * a slower answer rather than a meal logged as a guess, which is the failure a
 * food tracker with a single model has no answer to.
 *
 * There are two routes per feature: one for admins, one for everybody else.
 * Admins try things on their own meals; everybody gets what has been proven.
 *
 * **The privacy line.** The privacy policy (docs/privacy.md) names Anthropic
 * and Google, and says how each is used. Even so, sending everybody's meals,
 * photos and questions to Google is a switch somebody throws on purpose: on
 * everybody's route a feature that carries personal data can only use Claude
 * — enforced when a route is saved and again when it is used — until
 * SQUISH_GEMINI_FOR_EVERYONE=on is set in Render. A policy that stopped
 * naming Google would mean turning it off again. Translating the app's own
 * words carries nobody's data, so it may use any model.
 *
 * Kept in admin_settings (`model_routes`), changed on Dashboard → Settings,
 * and read with a few seconds' caching so a change takes effect at once
 * without a query on every call.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { hasDatabase, migrate, query } from './db';
import { isAdmin } from './admin';
import { DEFAULT_GEMINI, hasGeminiKey, isGeminiModel } from './gemini';
import { PRICED_MODELS } from './pricing';

export type Feature = 'photo' | 'label' | 'words' | 'fill' | 'recipe' | 'chat' | 'weekplan' | 'cook' | 'coach' | 'translate';
export type Audience = 'admins' | 'everyone';
export const AUDIENCES: Audience[] = ['admins', 'everyone'];

/** The longest chain: the model and two backups. */
export const MAX_CHAIN = 3;

const MAIN = process.env.SQUISH_MODEL ?? 'claude-opus-5';
/** Words rather than pictures go to a cheaper model first (see server/claude.ts). */
const TEXT = process.env.SQUISH_TEXT_MODEL ?? 'claude-sonnet-5';
const CHAT = process.env.SQUISH_CHAT_MODEL ?? MAIN;
const WEEK = process.env.SQUISH_WEEKPLAN_MODEL ?? MAIN;
const chain = (...models: string[]): string[] => [...new Set(models)];

export interface FeatureInfo {
  id: Feature;
  label: string;
  detail: string;
  /** Carries somebody's meals, photos or questions. */
  personal: boolean;
  /** What it runs on until somebody chooses otherwise: the model it always had, then the other Claude. */
  defaults: string[];
  /**
   * How long a model may take before its backup is asked instead, in seconds.
   * A company that is down usually says so at once; one that is struggling can
   * simply not answer, and without a limit the person waits minutes before the
   * backup gets its turn. Set well above a normal answer — a photo with
   * thinking is usually 10–40 seconds — so a slow good answer is not thrown
   * away, and never on the last model in a chain, which has nothing to hand to.
   */
  limit: number;
}

export const FEATURES: FeatureInfo[] = [
  { id: 'photo', label: 'Meal photos', detail: 'Reading a photo of a meal.', personal: true, defaults: chain(MAIN, TEXT), limit: 75 },
  { id: 'label', label: 'Nutrition labels', detail: 'Reading the figures off a packet.', personal: true, defaults: chain(MAIN, TEXT), limit: 60 },
  {
    id: 'words',
    label: 'Typed and spoken meals',
    detail: 'A meal described in words, a correction, and the answer to a question about a meal.',
    personal: true,
    defaults: chain(TEXT, MAIN),
    limit: 45,
  },
  {
    id: 'fill',
    label: 'Filling in figures',
    detail: 'The foods the food table could not answer, after a meal, recipe or plan is read.',
    personal: true,
    defaults: chain(TEXT, MAIN),
    // A week's worth of foods can be a long answer.
    limit: 240,
  },
  { id: 'recipe', label: 'Recipe imports', detail: 'One serving of a recipe from a web page.', personal: true, defaults: chain(MAIN, TEXT), limit: 75 },
  { id: 'chat', label: 'Nutritionist', detail: 'Questions to the nutritionist, and its lookups in the diary.', personal: true, defaults: chain(CHAT, TEXT), limit: 60 },
  // A week of meals with reasoning can take Sonnet or Opus well over five minutes, and nobody is
  // watching it: ten, so a slow good plan is never thrown away for a backup to start again from nothing.
  { id: 'weekplan', label: 'Meal plans', detail: 'A week of meals from the nutritionist.', personal: true, defaults: chain(WEEK, TEXT), limit: 600 },
  {
    id: 'cook',
    label: 'Cooking steps',
    detail: 'How to cook a planned meal, written the first time it is opened and kept.',
    personal: true,
    defaults: chain(TEXT, MAIN),
    limit: 45,
  },
  { id: 'coach', label: 'Daily nudge', detail: 'The one-line note on Home.', personal: true, defaults: chain(MAIN, TEXT), limit: 20 },
  {
    id: 'translate',
    label: 'Translating the app',
    detail: 'The app’s own words, into other languages. Nobody’s data.',
    personal: false,
    defaults: chain(MAIN, TEXT),
    limit: 180,
  },
];

const FEATURE = new Map(FEATURES.map((f) => [f.id, f]));
export const isFeature = (value: unknown): value is Feature => typeof value === 'string' && FEATURE.has(value as Feature);

export type Routes = Record<Feature, Record<Audience, string[]>>;

/** Everybody's personal data may go to Gemini: set on purpose, and only while the privacy policy names Google. */
export const everyoneMayUseGemini = (): boolean => process.env.SQUISH_GEMINI_FOR_EVERYONE === 'on';

/** Why a model cannot go on a route, or null if it can. */
export function refusal(model: string, feature: Feature, audience: Audience): string | null {
  if (!PRICED_MODELS.includes(model)) return `${model} is not a model Squish has a price for.`;
  if (isGeminiModel(model) && audience === 'everyone' && FEATURE.get(feature)!.personal && !everyoneMayUseGemini()) {
    return `Gemini is not switched on for everybody, so ${FEATURE.get(feature)!.label.toLowerCase()} for everybody stay with Claude. To allow it, set SQUISH_GEMINI_FOR_EVERYONE=on in Render.`;
  }
  return null;
}

const defaults = (): Routes =>
  Object.fromEntries(FEATURES.map((f) => [f.id, { admins: [...f.defaults], everyone: [...f.defaults] }])) as Routes;

let cache: { at: number; routes: Routes } | null = null;
const CACHE_MS = 5_000;

/**
 * Every feature's routes: the defaults, then what was chosen. A chain that no
 * longer passes — a model since removed, a rule since tightened — falls back
 * to the default rather than being half-used.
 */
export async function readRoutes(): Promise<Routes> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.routes;
  const routes = defaults();
  if (hasDatabase()) {
    await migrate();
    const rows = await query<{ key: string; value: string }>(
      `select key, value from admin_settings where key in ('model_routes', 'gemini_trial', 'gemini_model')`,
    );
    const setting = new Map(rows.map((row) => [row.key, row.value]));
    const saved = parse(setting.get('model_routes'));
    // The Gemini trial's switch, from before routes: an admin's photos on Gemini, Claude behind it.
    if (!saved && setting.get('gemini_trial') === 'on') {
      const model = setting.get('gemini_model') ?? DEFAULT_GEMINI;
      routes.photo.admins = chain(PRICED_MODELS.includes(model) ? model : DEFAULT_GEMINI, ...routes.photo.admins).slice(0, MAX_CHAIN);
    }
    for (const f of FEATURES) {
      for (const audience of AUDIENCES) {
        const models = saved?.[f.id]?.[audience];
        if (Array.isArray(models) && models.length && models.length <= MAX_CHAIN && models.every((m) => typeof m === 'string' && !refusal(m, f.id, audience))) {
          routes[f.id][audience] = chain(...models);
        }
      }
    }
  }
  cache = { at: Date.now(), routes };
  return routes;
}

/** For the tests, which change the setting underneath. */
export const forgetRoutes = (): void => {
  cache = null;
};

function parse(value: string | undefined): Partial<Record<Feature, Partial<Record<Audience, unknown>>>> | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export type RoutesChange = { ok: true; routes: Routes } | { ok: false; message: string };

/** Save every route at once, or none of them, with the first thing wrong. */
export async function saveRoutes(next: unknown): Promise<RoutesChange> {
  if (!hasDatabase()) return { ok: false, message: 'This Squish keeps no settings.' };
  if (!next || typeof next !== 'object') return { ok: false, message: 'Nothing to save.' };
  const clean = {} as Routes;
  for (const f of FEATURES) {
    clean[f.id] = {} as Record<Audience, string[]>;
    for (const audience of AUDIENCES) {
      const models = (next as Routes)[f.id]?.[audience];
      if (!Array.isArray(models) || !models.length) return { ok: false, message: `${f.label} needs a model for ${audience}.` };
      if (models.length > MAX_CHAIN) return { ok: false, message: `${f.label}: a model and at most ${MAX_CHAIN - 1} backups.` };
      for (const model of models) {
        const why = typeof model === 'string' ? refusal(model, f.id, audience) : 'Not a model.';
        if (why) return { ok: false, message: why };
      }
      clean[f.id][audience] = chain(...models);
    }
  }
  await migrate();
  await query(
    `insert into admin_settings (key, value) values ('model_routes', $1)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(clean)],
  );
  cache = null;
  return { ok: true, routes: await readRoutes() };
}

/** One line at start-up for each route that is not the usual. */
export async function describeRoutes(): Promise<void> {
  const routes = await readRoutes();
  for (const f of FEATURES) {
    for (const audience of AUDIENCES) {
      const models = routes[f.id][audience];
      if (models.join() !== f.defaults.join()) console.log(`    AI: ${f.label.toLowerCase()} for ${audience} on ${models.join(' → ')}`);
    }
  }
}

/* ---------------- Who is being served ---------------- */

interface Served {
  feature: Feature;
  model: string;
  failed: { model: string; error: string }[];
}

const store = new AsyncLocalStorage<{ audience: Audience; served: Served[] }>();

/** Run a request (or a job) as an admin's or as everybody's. */
export function servedAs<T>(audience: Audience, body: () => T): T {
  return store.run({ audience, served: [] }, body);
}

/** Whose route applies. Anything outside a request — a warm-up, a script — is everybody's. */
export const currentAudience = (): Audience => store.getStore()?.audience ?? 'everyone';

/** What answered so far in this request, and what failed first: for an admin's Review screen. */
export function servedBy(feature: Feature): Served | undefined {
  return [...(store.getStore()?.served ?? [])].reverse().find((s) => s.feature === feature);
}

/** An admin's device or anybody's: for a job picked up with no request around it. */
export async function audienceOf(deviceId: string | null): Promise<Audience> {
  if (!deviceId || !hasDatabase()) return 'everyone';
  const rows = await query<{ account_id: string | null }>('select account_id from devices where id = $1', [deviceId]);
  const accountId = rows[0]?.account_id;
  return accountId && (await isAdmin({ id: deviceId, accountId })) ? 'admins' : 'everyone';
}

/* ---------------- Asking, with backups ---------------- */

let warnedNoKey = false;

/**
 * The chain for this feature, for whoever is being served, with anything that
 * cannot run right now taken out: a Gemini model with no key, or — belt and
 * braces — a Gemini model on everybody's route for their data.
 */
export async function modelsFor(feature: Feature): Promise<string[]> {
  const audience = currentAudience();
  const routes = await readRoutes().catch(() => defaults());
  const usable = routes[feature][audience].filter((model) => {
    if (refusal(model, feature, audience)) return false;
    if (isGeminiModel(model) && !hasGeminiKey()) {
      if (!warnedNoKey) console.warn(`[squish] a route names ${model} but GEMINI_API_KEY is not set — skipping it`);
      warnedNoKey = true;
      return false;
    }
    return true;
  });
  return usable.length ? usable : FEATURE.get(feature)!.defaults;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 300);

/** A model that did not answer within its feature's limit, so its backup was asked. */
export class TimeLimit extends Error {
  constructor(seconds: number) {
    super(`no answer within ${seconds} s`);
  }
}

/**
 * Ask the feature's models in turn until one answers. `run` does the whole
 * job on the model it is given — the call and the reading of the answer — so
 * an answer that will not parse counts as a failure too. It is handed a
 * signal to pass to the call, which stops it when its time is up.
 *
 * A model with a backup behind it has the feature's time limit; the last one
 * has none, because a slow answer beats no answer. Stopping on purpose (the
 * caller's signal) is never retried, and nor is anything `final` says would
 * fail the same way anywhere.
 */
export async function withModels<T>(
  feature: Feature,
  run: (model: string, attempt: number, signal: AbortSignal) => Promise<T>,
  options: {
    signal?: AbortSignal;
    final?: (error: unknown) => boolean;
    /** One model named by the caller — the benchmark, the eval — rather than the route. */
    models?: string[];
    /** Count failures on the dashboard even so. Named models are measurements, not the service, and are not counted. */
    record?: boolean;
    /** Instead of the feature's own limit, in milliseconds: for the tests. */
    limitMs?: number;
  } = {},
): Promise<T> {
  const models = options.models ?? (await modelsFor(feature));
  const record = !options.models || options.record === true;
  const limitMs = options.limitMs ?? FEATURE.get(feature)!.limit * 1000;
  const failed: Served['failed'] = [];
  let last: unknown = new Error('No model to ask.');
  for (const [attempt, model] of models.entries()) {
    const stop = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
    let timer: NodeJS.Timeout | undefined;
    // Raced rather than trusted to the signal alone: whatever is not waiting on the network when time runs out is left behind too.
    const outOfTime =
      attempt < models.length - 1
        ? new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              // The reason first, then the stop: a call that fails the moment it is stopped must not win the race with "aborted".
              reject(new TimeLimit(Math.round(limitMs / 1000)));
              stop.abort();
            }, limitMs);
          })
        : null;
    try {
      const answer = run(model, attempt, signal);
      const result = await (outOfTime ? Promise.race([answer, outOfTime]) : answer);
      store.getStore()?.served.push({ feature, model, failed: [...failed] });
      if (failed.length && record) void noteFailures(feature, failed, true);
      return result;
    } catch (error) {
      last = error;
      if (options.signal?.aborted || options.final?.(error)) throw error;
      failed.push({ model, error: reason(error) });
      const next = models[attempt + 1];
      console.warn(`[squish] ${feature}: ${model} failed (${reason(error)})${next ? ` — trying ${next}` : ' — no backup left'}`);
    } finally {
      clearTimeout(timer);
    }
  }
  if (record) void noteFailures(feature, failed, false);
  throw last;
}

/** Kept by day, for the dashboard: which model failed at what, and whether a backup saved it. */
async function noteFailures(feature: Feature, failed: Served['failed'], rescued: boolean): Promise<void> {
  if (!hasDatabase()) return;
  try {
    for (const { model, error } of failed) {
      await query(
        `insert into ai_fallbacks (day, feature, model, failures, rescued, last_error) values (current_date, $1, $2, 1, $3, $4)
         on conflict (day, feature, model) do update set failures = ai_fallbacks.failures + 1,
           rescued = ai_fallbacks.rescued + excluded.rescued, last_error = excluded.last_error, updated_at = now()`,
        [feature, model, rescued ? 1 : 0, error],
      );
    }
  } catch {
    /* a gap in a report, never a failed request */
  }
}

export interface FailureSummary {
  feature: Feature;
  model: string;
  failures: number;
  rescued: number;
  lastError: string;
  lastAt: string;
}

/** The last week's failures, most recent first. */
export async function recentFailures(days = 7): Promise<FailureSummary[]> {
  if (!hasDatabase()) return [];
  await migrate();
  const rows = await query<{ feature: Feature; model: string; failures: string; rescued: string; last_error: string; last_at: Date }>(
    `select feature, model, sum(failures)::text as failures, sum(rescued)::text as rescued,
            (array_agg(last_error order by updated_at desc))[1] as last_error, max(updated_at) as last_at
       from ai_fallbacks where day > current_date - $1::int
      group by feature, model order by max(updated_at) desc`,
    [days],
  );
  return rows.map((row) => ({
    feature: row.feature,
    model: row.model,
    failures: Number(row.failures),
    rescued: Number(row.rescued),
    lastError: row.last_error,
    lastAt: new Date(row.last_at).toISOString(),
  }));
}
