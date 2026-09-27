/**
 * Trying Gemini on the admins' own meals, and nobody else's.
 *
 * The privacy policy tells people their photos go to Anthropic. It says
 * nothing about Google, so an ordinary person's photo must never go there
 * — whatever this switch says. What the switch allows is narrower: the
 * people running Squish, on their own accounts, having their own meal photos
 * read by Gemini instead of Claude, to see what it is like day to day before
 * deciding anything for everybody (and changing the policy first).
 *
 * All three must hold, or it is Claude, as for everybody:
 *   1. the switch is on (Dashboard → Settings, kept in admin_settings),
 *   2. there is a Gemini key (GEMINI_API_KEY), and
 *   3. the device asking is signed in as an admin (SQUISH_ADMIN_EMAILS).
 *
 * Meal photos only: nutrition labels, typed meals and everything else stay
 * with Claude.
 */
import { hasDatabase, migrate, query } from './db';
import { isAdmin } from './admin';
import { DEFAULT_GEMINI, hasGeminiKey } from './gemini';
import type { Device } from './identity';

export const DEFAULT_GEMINI_MODEL = DEFAULT_GEMINI;

export interface GeminiTrial {
  /** Admins' meal photos go to Gemini. */
  on: boolean;
  /** Which Gemini model reads them. */
  model: string;
  /** Whether the server has a key to use — without one the switch does nothing. */
  keySet: boolean;
}

/** A Gemini model's name, and nothing that could be anything else in an address. */
export const isGeminiName = (name: unknown): name is string => typeof name === 'string' && /^gemini-[a-z0-9][a-z0-9.-]{0,60}$/.test(name);

export async function readGeminiTrial(): Promise<GeminiTrial> {
  const trial: GeminiTrial = { on: false, model: DEFAULT_GEMINI_MODEL, keySet: hasGeminiKey() };
  if (!hasDatabase()) return trial;
  await migrate();
  const rows = await query<{ key: string; value: string }>(`select key, value from admin_settings where key in ('gemini_trial', 'gemini_model')`);
  for (const row of rows) {
    if (row.key === 'gemini_trial') trial.on = row.value === 'on';
    if (row.key === 'gemini_model' && isGeminiName(row.value)) trial.model = row.value;
  }
  return trial;
}

export type TrialChange = { ok: true; trial: GeminiTrial } | { ok: false; message: string };

export async function saveGeminiTrial(changes: { on?: unknown; model?: unknown }): Promise<TrialChange> {
  if (!hasDatabase()) return { ok: false, message: 'This Squish keeps no settings.' };
  if (changes.on !== undefined && typeof changes.on !== 'boolean') return { ok: false, message: 'On or off?' };
  if (changes.model !== undefined && !isGeminiName(changes.model)) {
    return { ok: false, message: `A Gemini model name, like ${DEFAULT_GEMINI}.` };
  }
  await migrate();
  const save = (key: string, value: string) =>
    query(`insert into admin_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`, [key, value]);
  if (typeof changes.on === 'boolean') await save('gemini_trial', changes.on ? 'on' : 'off');
  if (isGeminiName(changes.model)) await save('gemini_model', changes.model);
  return { ok: true, trial: await readGeminiTrial() };
}

/**
 * Who reads this device's meal photo. Claude unless every condition holds —
 * and Claude too if anything goes wrong finding out. With the switch on but
 * no key, it says so in the log: that is the one way the trial can look on
 * and quietly do nothing.
 */
export async function photoReader(device: Device | undefined): Promise<{ reader: 'claude' } | { reader: 'gemini'; model: string }> {
  try {
    if (!device?.accountId) return { reader: 'claude' };
    const trial = await readGeminiTrial();
    const admin = await isAdmin(device);
    if (!admin) return { reader: 'claude' };
    // An admin's photo is the one place the trial could apply: say plainly why it did not.
    if (!trial.on) {
      console.info('[squish] gemini trial: off, so this admin photo was read by Claude — turn it on in Dashboard → Settings');
      return { reader: 'claude' };
    }
    if (!trial.keySet) {
      console.warn('[squish] gemini trial: the switch is on but GEMINI_API_KEY is not set in Render — reading with Claude');
      return { reader: 'claude' };
    }
    return { reader: 'gemini', model: trial.model };
  } catch {
    return { reader: 'claude' };
  }
}

/** One line at start-up: whether the trial is on, and whether it can be. */
export async function describeGeminiTrial(): Promise<string> {
  const trial = await readGeminiTrial();
  if (!trial.on) return `Gemini trial: off${trial.keySet ? ' (key set)' : ' (no GEMINI_API_KEY)'} — turn it on in Dashboard → Settings`;
  return trial.keySet
    ? `Gemini trial: on — admins' meal photos go to ${trial.model}`
    : 'Gemini trial: on, but GEMINI_API_KEY is not set — nothing goes to Gemini';
}
