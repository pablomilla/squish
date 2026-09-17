import type { AnalysisResult, MealSlot } from '../types';
import { demoEstimateFromPhoto, estimateFromText } from './estimate';

const TIMEOUT_MS = 45_000;
const PASS_KEY = 'squish-pass';

/**
 * Errors the user needs to see rather than silently absorb. A locked or
 * rate-limited request must not quietly turn into an offline estimate — that
 * would look like a working analysis.
 */
export class SquishApiError extends Error {
  kind: 'locked' | 'rate_limited';

  constructor(kind: 'locked' | 'rate_limited', message: string) {
    super(message);
    this.name = 'SquishApiError';
    this.kind = kind;
  }
}

export function storedPasscode(): string {
  try {
    return localStorage.getItem(PASS_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberPasscode(passcode: string): void {
  try {
    localStorage.setItem(PASS_KEY, passcode);
  } catch {
    /* private browsing — the passcode is simply asked for again */
  }
}

export function forgetPasscode(): void {
  try {
    localStorage.removeItem(PASS_KEY);
  } catch {
    /* nothing to do */
  }
}

let onLockedHandler: (() => void) | null = null;

/** The app registers here so a rejected passcode sends it back to the lock screen. */
export function onLocked(handler: () => void): void {
  onLockedHandler = handler;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const passcode = storedPasscode();
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(passcode ? { 'x-squish-pass': passcode } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.status === 401) {
      forgetPasscode();
      onLockedHandler?.();
      throw new SquishApiError('locked', 'This Squish needs its passcode again.');
    }
    if (response.status === 429) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      throw new SquishApiError('rate_limited', payload.message ?? 'Too many meals in one hour — try again shortly.');
    }
    if (!response.ok) throw new Error(`${path} responded ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface AiStatus {
  ok: boolean;
  ai: boolean;
  model: string;
  /** True when the server was started with a passcode set. */
  locked?: boolean;
}

/** Check a passcode against the server. Remembers it on success. */
export async function unlock(passcode: string): Promise<boolean> {
  try {
    const response = await fetch('/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    if (!response.ok) return false;
    rememberPasscode(passcode);
    return true;
  } catch {
    return false;
  }
}

/** Generous: a sleeping free-tier host can take the best part of a minute to wake. */
const HEALTH_TIMEOUT_MS = 90_000;

export async function aiStatus(): Promise<AiStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch('/api/health', { signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as AiStatus;
  } catch {
    // Unreachable or too slow — let the app open anyway. It works offline, and
    // a locked server will send the user to the lock screen on the first call.
    return { ok: false, ai: false, model: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/** Analyse a meal photo. Falls back to a local estimate if the API is unreachable. */
export async function analysePhoto(dataUrl: string, slot?: MealSlot, hint?: string): Promise<AnalysisResult> {
  try {
    return await post<AnalysisResult>('/api/analyse/photo', { image: dataUrl, slot, hint });
  } catch (error) {
    if (error instanceof SquishApiError) throw error;
    return demoEstimateFromPhoto(dataUrl.slice(-256), slot);
  }
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
