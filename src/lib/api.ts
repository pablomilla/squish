import type { AnalysisResult, MealSlot } from '../types';
import { demoEstimateFromPhoto, estimateFromText } from './estimate';

const TIMEOUT_MS = 45_000;

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
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
}

export async function aiStatus(): Promise<AiStatus> {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as AiStatus;
  } catch {
    return { ok: false, ai: false, model: 'offline' };
  }
}

/** Analyse a meal photo. Falls back to a local estimate if the API is unreachable. */
export async function analysePhoto(dataUrl: string, slot?: MealSlot, hint?: string): Promise<AnalysisResult> {
  try {
    return await post<AnalysisResult>('/api/analyse/photo', { image: dataUrl, slot, hint });
  } catch {
    return demoEstimateFromPhoto(dataUrl.slice(-256), slot);
  }
}

/** Analyse a written meal description. */
export async function analyseText(description: string, slot?: MealSlot): Promise<AnalysisResult> {
  try {
    return await post<AnalysisResult>('/api/analyse/text', { description, slot });
  } catch {
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
