/**
 * Squish API server.
 *
 * In development it serves the API only and Vite proxies to it. In production
 * it also serves the built app, so the whole thing is one deployable service
 * on one port.
 *
 * The Anthropic key stays here — the browser never sees it. When no key is
 * configured every endpoint still answers, using the offline estimator, and
 * marks the response `offline: true` so the UI can label it honestly.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AnalysisResult, MealSlot } from '../src/types';
import { demoEstimateFromPhoto, estimateFromText } from '../src/lib/estimate';
import { BarcodeError, lookupBarcode } from './barcode';
import { FetchGuardError, readRecipePage } from './recipe';
import { chatStep, cleanMessages, cleanNotes, toolRounds, type ChatUsage } from './chat';
import { hasDatabase } from './db';
import { deviceFor, registerDevice, spend, spentToday, type Device, type Spend } from './identity';
import {
  analyseLabel,
  analysePhoto,
  analyseRecipe,
  analyseText,
  coachMessage,
  credentialSource,
  hasCredentials,
  refineAnalysis,
  type CoachContext,
} from './claude';

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(identify);

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(process.cwd(), 'dist');
const SERVE_APP = existsSync(DIST);

/** Set this on a public deployment, or anyone who finds the URL spends your credit. */
const PASSCODE = process.env.SQUISH_PASSCODE?.trim();

/** Analyses per IP per hour. A backstop on the bill if the passcode leaks. */
const RATE_LIMIT = Number(process.env.SQUISH_RATE_LIMIT ?? 80);
const HOUR_MS = 3_600_000;

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const asSlot = (value: unknown): MealSlot | undefined =>
  typeof value === 'string' && SLOTS.includes(value as MealSlot) ? (value as MealSlot) : undefined;

function logFailure(where: string, error: unknown): void {
  console.warn(`[squish] ${where} fell back to the offline estimator:`, error instanceof Error ? error.message : error);
}

/**
 * What the nutritionist just spent, one line per call.
 *
 * Numbers only — no question, no answer, nothing from anybody's diary. It is
 * there to answer "what does this feature cost per user", which until now was
 * a question nobody could answer from anything but arithmetic. One question
 * makes one line per round, so `round=0` marks where each new question starts.
 *
 * `cached` against `wrote` is the caching working or not: after the first call
 * of the day most of the prompt should be read rather than written.
 */
function logUsage(usage: ChatUsage, round: number): void {
  const money = usage.costUsd === null ? 'unpriced' : `$${usage.costUsd.toFixed(4)}`;
  console.info(
    `[squish] nutritionist round=${round} model=${usage.model} ` +
      `in=${usage.inputTokens} cached=${usage.cacheReadTokens} wrote=${usage.cacheWriteTokens} ` +
      `out=${usage.outputTokens} (thinking ${usage.thinkingTokens}) ${money} ${(usage.latencyMs / 1000).toFixed(1)}s`,
  );
}

/* ------------------------------------------------------------------ *
 * Passcode
 * ------------------------------------------------------------------ */

/** Compare digests, not the strings — equal length, and no early exit. */
function matchesPasscode(candidate: unknown): boolean {
  if (!PASSCODE) return true;
  if (typeof candidate !== 'string' || !candidate) return false;
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(PASSCODE).digest();
  return timingSafeEqual(a, b);
}

function requirePasscode(req: Request, res: Response, next: NextFunction): void {
  if (!PASSCODE) {
    next();
    return;
  }
  if (matchesPasscode(req.header('x-squish-pass'))) {
    next();
    return;
  }
  res.status(401).json({ error: 'locked', message: 'This Squish needs its passcode.' });
}

/* ------------------------------------------------------------------ *
 * Who is asking
 * ------------------------------------------------------------------ */

declare module 'express-serve-static-core' {
  interface Request {
    device?: Device;
  }
}

/**
 * Attach the device, if there is one, before anything that counts.
 *
 * Never rejects. A request with no token, a stale token or no database at all
 * carries on as an anonymous one and meets the old per-IP limit instead —
 * which is what keeps every existing browser working on the day this ships,
 * and what keeps the app running on a laptop with no database at all.
 */
async function identify(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.device = (await deviceFor(readToken(req))) ?? undefined;
  } catch (error) {
    logFailure('device lookup', error);
  }
  next();
}

const readToken = (req: Request): string | undefined => {
  const header = req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
};

/* ------------------------------------------------------------------ *
 * Rate limit — per device where one is known, per IP where it is not.
 *
 * The IP version is the fallback rather than the rule now. Everybody on the
 * same mobile network shares an address, so it could lock out a whole carrier
 * because of one enthusiastic user, and being in memory it forgave everybody
 * whenever the service restarted. A device is the thing worth counting.
 * ------------------------------------------------------------------ */

const hits = new Map<string, { count: number; resetAt: number }>();

/** How much a known device may spend in a day, per kind of call. */
const DAILY: Record<Spend, number> = {
  photo: Number(process.env.SQUISH_DAILY_PHOTOS ?? 25),
  chat: Number(process.env.SQUISH_DAILY_CHATS ?? 40),
  recipe: Number(process.env.SQUISH_DAILY_RECIPES ?? 10),
};

/** Count this call against the device, and refuse it if the day is spent. */
function meter(kind: Spend) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.device || DAILY[kind] <= 0) {
      rateLimit(req, res, next);
      return;
    }
    try {
      const used = await spend(req.device.id, kind);
      if (used > DAILY[kind]) {
        res.status(429).json({
          error: 'rate_limited',
          message: `That is ${DAILY[kind]} for today. It starts again tomorrow.`,
        });
        return;
      }
    } catch (error) {
      // A metering failure must not stop somebody logging their lunch. It
      // falls back to the address-based limit, which is worse but is not off.
      logFailure('metering', error);
      rateLimit(req, res, next);
      return;
    }
    next();
  };
}

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  if (RATE_LIMIT <= 0) {
    next();
    return;
  }
  const now = Date.now();
  const key = req.ip ?? 'unknown';
  const entry = hits.get(key);

  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + HOUR_MS });
    if (hits.size > 5000) {
      for (const [ip, seen] of hits) if (seen.resetAt < now) hits.delete(ip);
    }
    next();
    return;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT) {
    const minutes = Math.ceil((entry.resetAt - now) / 60_000);
    res.status(429).json({
      error: 'rate_limited',
      message: `That is ${RATE_LIMIT} meals in an hour — give it ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    });
    return;
  }
  next();
}

// Render and friends sit behind a proxy; without this every request looks
// like it comes from the same address and the rate limit hits everyone at once.
app.set('trust proxy', 1);

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

/* ---------------- Who is asking ---------------- *
 *
 * No passcode on this one. A device that has never been here has nothing to
 * present, and the token it gets back is what it presents from then on.
 */
app.post('/api/device', async (_req, res) => {
  if (!hasDatabase()) {
    // Not an error. It is how Squish runs on a laptop, and the client is
    // written to carry on without one.
    res.status(503).json({ error: 'no_database', message: 'This Squish keeps nothing on the server.' });
    return;
  }
  try {
    res.json(await registerDevice());
  } catch (error) {
    logFailure('device registration', error);
    res.status(503).json({ error: 'no_database', message: 'Could not set this device up just now.' });
  }
});

/** What is left today, so the app can say so before somebody runs into it. */
app.get('/api/allowance', async (req, res) => {
  if (!req.device) {
    res.json({ known: false });
    return;
  }
  try {
    const kinds = Object.keys(DAILY) as Spend[];
    const used = await Promise.all(kinds.map((kind) => spentToday(req.device!.id, kind)));
    res.json({
      known: true,
      account: Boolean(req.device.accountId),
      left: Object.fromEntries(kinds.map((kind, i) => [kind, Math.max(0, DAILY[kind] - used[i])])),
      daily: DAILY,
    });
  } catch (error) {
    logFailure('allowance', error);
    res.json({ known: false });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ai: hasCredentials(),
    model: process.env.SQUISH_MODEL ?? 'claude-opus-5',
    locked: Boolean(PASSCODE),
    // So the app knows whether to bother asking for a device, a backup or an
    // account. Without a database none of those exist and it stays local.
    accounts: hasDatabase(),
  });
});

/** Exchange the passcode for a yes/no, so the app can show its lock screen. */
app.post('/api/unlock', (req, res) => {
  if (matchesPasscode(req.body?.passcode)) {
    res.json({ ok: true });
    return;
  }
  res.status(401).json({ ok: false, message: 'That passcode did not match.' });
});

/** A number from a request body, or nothing. */
const inRange = (value: unknown, min: number, max: number): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
};

/** Vision analysis of a photo. Body: { image: dataURL | base64, mediaType?, slot?, hint?, mode?, crockery? } */
app.post('/api/analyse/photo', requirePasscode, meter('photo'), async (req, res) => {
  const { image, mediaType, slot, hint, mode, crockery } = req.body ?? {};
  if (typeof image !== 'string' || image.length < 32) {
    res.status(400).json({ error: 'An image is required.' });
    return;
  }

  const match = image.match(/^data:([^;]+);base64,(.*)$/);
  const data = match ? match[2] : image;
  const type = match ? match[1] : typeof mediaType === 'string' ? mediaType : 'image/jpeg';
  const mealSlot = asSlot(slot);

  const label = mode === 'label';

  if (!hasCredentials()) {
    // A made-up plate is a passable demo; made-up figures off a packet are a lie.
    if (label) {
      res.status(503).json({ error: 'Squish is offline, so a label cannot be read. Search for it or add it by hand.' });
      return;
    }
    res.json(demoEstimateFromPhoto(data.slice(0, 256), mealSlot));
    return;
  }

  try {
    res.json(
      label
        ? await analyseLabel(data, type, mealSlot)
        : await analysePhoto(data, type, mealSlot, typeof hint === 'string' ? hint : undefined, {
            // Sizes, not free text: this goes straight into a prompt.
            plateCm: inRange(crockery?.plateCm, 15, 40),
            bowlMl: inRange(crockery?.bowlMl, 150, 1500),
          }),
    );
  } catch (error) {
    logFailure('photo analysis', error);
    res.json(demoEstimateFromPhoto(data.slice(0, 256), mealSlot));
  }
});

/** Natural-language analysis. Body: { description, slot? } */
app.post('/api/analyse/text', requirePasscode, meter('photo'), async (req, res) => {
  const { description, slot } = req.body ?? {};
  if (typeof description !== 'string' || !description.trim()) {
    res.status(400).json({ error: 'A description is required.' });
    return;
  }
  const mealSlot = asSlot(slot);

  if (!hasCredentials()) {
    res.json(estimateFromText(description, mealSlot));
    return;
  }

  try {
    res.json(await analyseText(description.trim(), mealSlot));
  } catch (error) {
    logFailure('text analysis', error);
    res.json(estimateFromText(description, mealSlot));
  }
});

/** Look a barcode up in Open Food Facts. */
app.get('/api/barcode/:code', requirePasscode, async (req, res) => {
  try {
    // Express 5 types a route param as possibly repeated; the validator in
    // lookupBarcode rejects anything that is not plain digits regardless.
    const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
    const slot = Array.isArray(req.query.slot) ? req.query.slot[0] : req.query.slot;
    res.json(await lookupBarcode(String(code), asSlot(slot)));
  } catch (error) {
    if (error instanceof BarcodeError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    logFailure('barcode lookup', error);
    res.status(502).json({ error: 'The food database is having a moment. Try again shortly.' });
  }
});

/**
 * Ask Squish a question. Body: { turns, context }
 *
 * Rate limited like the analysis endpoints, because a chat box is the easiest
 * thing in the app to leave running up a bill.
 */
app.post('/api/chat', requirePasscode, meter('chat'), async (req, res) => {
  const { turns, context, notes } = req.body ?? {};

  const messages = cleanMessages(turns);
  if (!messages) {
    res.status(400).json({ error: 'Ask me something.' });
    return;
  }
  if (!hasCredentials()) {
    res.status(503).json({ error: 'Squish needs the AI to answer questions, and no key is configured here.' });
    return;
  }

  try {
    const step = await chatStep(
      messages,
      {
        // A date the browser did not send is today here, which is near enough
        // and far better than leaving it to be guessed at.
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(context?.date)) ? String(context.date) : new Date().toISOString().slice(0, 10),
        goal: String(context?.goal ?? 'maintain'),
        calorieTarget: Number(context?.calorieTarget) || 2000,
        proteinTarget: Number(context?.proteinTarget) || 100,
        today: String(context?.today ?? 'nothing logged'),
        week: String(context?.week ?? 'nothing logged'),
        streak: Number(context?.streak) || 0,
        recentMeals: Array.isArray(context?.recentMeals)
          ? context.recentMeals.slice(0, 12).map((m: unknown) => String(m).slice(0, 80))
          : [],
      },
      cleanNotes(notes),
    );
    logUsage(step.usage, toolRounds(messages));

    // The browser has no use for the bill, so it does not travel.
    const { usage: _usage, ...wire } = step;
    res.json(wire);
  } catch (error) {
    logFailure('chat', error);
    res.status(502).json({ error: 'I could not think of an answer just then. Try again in a moment.' });
  }
});

/**
 * Import a recipe from a web page. Body: { url, slot }
 *
 * Unlike the other endpoints this one has no offline fallback: the estimator
 * can guess at "chicken salad" but it cannot read a web page, and returning an
 * invented recipe would be worse than saying no.
 */
app.post('/api/recipe', requirePasscode, meter('recipe'), async (req, res) => {
  const { url, slot } = req.body ?? {};

  if (typeof url !== 'string' || !url.trim()) {
    res.status(400).json({ error: 'Paste the address of a recipe page.' });
    return;
  }
  if (!hasCredentials()) {
    res.status(503).json({ error: 'Reading a recipe needs the AI, and no key is configured on this server.' });
    return;
  }

  try {
    const source = await readRecipePage(url);
    res.json(await analyseRecipe(source, asSlot(slot)));
  } catch (error) {
    if (error instanceof FetchGuardError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    logFailure('recipe import', error);
    res.status(502).json({ error: 'That recipe could not be read. Try another page.' });
  }
});

/** Correct an analysis in words. Body: { analysis, instruction, slot } */
app.post('/api/analyse/refine', requirePasscode, meter('photo'), async (req, res) => {
  const { analysis, instruction, slot } = req.body ?? {};

  if (typeof instruction !== 'string' || !instruction.trim()) {
    res.status(400).json({ error: 'Tell me what to change.' });
    return;
  }
  if (!analysis || !Array.isArray(analysis.items)) {
    res.status(400).json({ error: 'There is no meal to correct.' });
    return;
  }
  // Without a key there is nothing to re-read the meal with, and silently
  // handing back the same analysis would look like the correction was ignored.
  if (!hasCredentials()) {
    res.status(503).json({ error: 'Squish is offline, so this one needs editing by hand.' });
    return;
  }

  try {
    res.json(await refineAnalysis(analysis as AnalysisResult, instruction.trim(), asSlot(slot)));
  } catch (error) {
    logFailure('refinement', error);
    res.status(502).json({ error: 'I could not work that out — try editing it by hand.' });
  }
});

/** Daily coach nudge. Body: CoachContext */
app.post('/api/coach', requirePasscode, async (req, res) => {
  const ctx = req.body as CoachContext;
  if (!hasCredentials()) {
    res.json({ message: null, offline: true });
    return;
  }
  try {
    res.json({ message: await coachMessage(ctx) });
  } catch (error) {
    logFailure('coach message', error);
    res.json({ message: null, offline: true });
  }
});

/* ------------------------------------------------------------------ *
 * The built app, when there is one (production)
 * ------------------------------------------------------------------ */

if (SERVE_APP) {
  app.use(express.static(DIST, { maxAge: '1h', index: false }));
  // Anything that is not an API route is a client route: hand back index.html
  // and let the app work out which screen that is.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(resolve(DIST, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🫧  Squish on http://localhost:${PORT}`);
  const source = credentialSource();
  console.log(
    hasCredentials()
      ? `    Claude vision enabled (${process.env.SQUISH_MODEL ?? 'claude-opus-5'}, via ${source})`
      : '    No Anthropic credentials found — serving offline estimates.',
  );
  if (!hasCredentials()) {
    console.log('    To enable photo analysis: set ANTHROPIC_API_KEY and restart.');
  }
  console.log(
    PASSCODE
      ? `    Passcode on · max ${RATE_LIMIT} analyses per hour per visitor`
      : '    Passcode OFF — set SQUISH_PASSCODE before putting this on a public URL.',
  );
  console.log(SERVE_APP ? '    Serving the built app from dist/' : '    API only (run Vite for the app).');

  // Reminders are the phone's job now — scheduled on the device by the app,
  // with nothing here that has to be awake at breakfast to deliver them.
});
