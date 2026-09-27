/**
 * The AI's one question about a meal, and its answer.
 *
 * When a meal could be read two ways that differ by a real number of calories
 * — the dressing, the cooking fat, the milk — the analysis carries one short
 * question with answers to tap (see `clarify` in src/types.ts). Tapping one
 * re-reads the meal with the answer, on the cheaper text model, and costs the
 * person nothing: the question was ours, so the answer should be free.
 *
 * Free is the reason for the signature. The server signs each question it
 * asks, with the answers it offered and an hour's life, so the free route
 * answers only questions it asked, with one of the answers it offered — it is
 * not a way to have any meal re-read for nothing. A daily cap on the route
 * (server/index.ts) covers the rest.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hasDatabase, migrate, query } from './db';
import type { AnalysisResult, Clarify } from '../src/types';

/** Long enough to look at the meal and tap; short enough not to be worth hoarding. */
export const CLARIFY_HOURS = 1;

let secret: Promise<Buffer> | null = null;

/** One key for every instance: made once, kept in the database. Without one, this process's own. */
function key(): Promise<Buffer> {
  secret ??= (async () => {
    if (process.env.SQUISH_CLARIFY_SECRET) return Buffer.from(process.env.SQUISH_CLARIFY_SECRET);
    if (!hasDatabase()) return randomBytes(32);
    await migrate();
    await query(`insert into server_secrets (name, value) values ('clarify', $1) on conflict (name) do nothing`, [randomBytes(32).toString('base64')]);
    const rows = await query<{ value: string }>(`select value from server_secrets where name = 'clarify'`);
    return Buffer.from(rows[0].value, 'base64');
  })().catch((error: unknown) => {
    secret = null; // try again next time rather than keep a failure
    throw error;
  });
  return secret;
}

const mac = async (question: string, choices: string[], expires: number): Promise<string> =>
  createHmac('sha256', await key()).update(JSON.stringify([question, choices, expires])).digest('base64url');

/** The analysis with its question signed — or without one, if it asked none. */
export async function signQuestion(analysis: AnalysisResult, now = Date.now()): Promise<AnalysisResult> {
  if (!analysis.clarify) return analysis;
  const { question, choices } = analysis.clarify;
  const expires = Math.floor(now / 1000) + CLARIFY_HOURS * 3600;
  return { ...analysis, clarify: { question, choices, token: `${expires}.${await mac(question, choices, expires)}` } };
}

/** Any question an analysis carries, taken off: for the answers that must not ask again. */
export function withoutQuestion(analysis: AnalysisResult): AnalysisResult {
  const { clarify: _asked, ...rest } = analysis;
  return rest;
}

export type Answerable = { ok: true; question: string; choice: string } | { ok: false; reason: 'invalid' | 'expired' };

/** Whether this is a question the server asked, still current, answered with one of its own answers. */
export async function checkAnswer(clarify: unknown, choice: unknown, now = Date.now()): Promise<Answerable> {
  const asked = clarify as Partial<Clarify> | null;
  if (!asked || typeof asked.question !== 'string' || !Array.isArray(asked.choices) || typeof asked.token !== 'string' || typeof choice !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  const choices = asked.choices.filter((c): c is string => typeof c === 'string');
  const [stamp, signature] = asked.token.split('.');
  const expires = Number(stamp);
  if (!Number.isInteger(expires) || !signature || choices.length !== asked.choices.length) return { ok: false, reason: 'invalid' };
  const expected = Buffer.from(await mac(asked.question, choices, expires));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };
  if (!choices.includes(choice)) return { ok: false, reason: 'invalid' };
  if (expires * 1000 < now) return { ok: false, reason: 'expired' };
  return { ok: true, question: asked.question, choice };
}
