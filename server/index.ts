/**
 * Squish API server.
 *
 * Keeps the Anthropic key server-side — the browser never sees it. When no key
 * is configured every endpoint still answers, using the offline estimator, and
 * marks the response `offline: true` so the UI can label it honestly.
 */
import cors from 'cors';
import express from 'express';
import type { MealSlot } from '../src/types';
import { demoEstimateFromPhoto, estimateFromText } from '../src/lib/estimate';
import { analysePhoto, analyseText, coachMessage, hasCredentials, type CoachContext } from './claude';

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));

const PORT = Number(process.env.PORT ?? 8787);

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const asSlot = (value: unknown): MealSlot | undefined =>
  typeof value === 'string' && SLOTS.includes(value as MealSlot) ? (value as MealSlot) : undefined;

function logFailure(where: string, error: unknown): void {
  console.warn(`[squish] ${where} fell back to the offline estimator:`, error instanceof Error ? error.message : error);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ai: hasCredentials(), model: process.env.SQUISH_MODEL ?? 'claude-opus-5' });
});

/** Vision analysis of a meal photo. Body: { image: dataURL | base64, mediaType?, slot?, hint? } */
app.post('/api/analyse/photo', async (req, res) => {
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
app.post('/api/analyse/text', async (req, res) => {
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
app.post('/api/coach', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`🫧  Squish API on http://localhost:${PORT}`);
  if (hasCredentials()) {
    console.log(`    Claude vision enabled (${process.env.SQUISH_MODEL ?? 'claude-opus-5'})`);
  } else {
    console.log('    No Anthropic credentials found — serving offline estimates.');
    console.log('    To enable photo analysis: put ANTHROPIC_API_KEY=sk-ant-... in .env and restart.');
  }
});
