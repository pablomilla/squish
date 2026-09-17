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
import type { MealSlot } from '../src/types';
import { demoEstimateFromPhoto, estimateFromText } from '../src/lib/estimate';
import { analysePhoto, analyseText, coachMessage, credentialSource, hasCredentials, type CoachContext } from './claude';

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));

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
 * Rate limit — per IP, in memory. Resets when the service restarts.
 * ------------------------------------------------------------------ */

const hits = new Map<string, { count: number; resetAt: number }>();

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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ai: hasCredentials(),
    model: process.env.SQUISH_MODEL ?? 'claude-opus-5',
    locked: Boolean(PASSCODE),
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

/** Vision analysis of a meal photo. Body: { image: dataURL | base64, mediaType?, slot?, hint? } */
app.post('/api/analyse/photo', requirePasscode, rateLimit, async (req, res) => {
  const { image, mediaType, slot, hint } = req.body ?? {};
  if (typeof image !== 'string' || image.length < 32) {
    res.status(400).json({ error: 'An image is required.' });
    return;
  }

  const match = image.match(/^data:([^;]+);base64,(.*)$/);
  const data = match ? match[2] : image;
  const type = match ? match[1] : typeof mediaType === 'string' ? mediaType : 'image/jpeg';
  const mealSlot = asSlot(slot);

  if (!hasCredentials()) {
    res.json(demoEstimateFromPhoto(data.slice(0, 256), mealSlot));
    return;
  }

  try {
    res.json(await analysePhoto(data, type, mealSlot, typeof hint === 'string' ? hint : undefined));
  } catch (error) {
    logFailure('photo analysis', error);
    res.json(demoEstimateFromPhoto(data.slice(0, 256), mealSlot));
  }
});

/** Natural-language analysis. Body: { description, slot? } */
app.post('/api/analyse/text', requirePasscode, rateLimit, async (req, res) => {
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
});
