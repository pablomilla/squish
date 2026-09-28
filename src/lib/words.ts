/**
 * Small words used all over the interface, translated in one place so a
 * meal slot is never "Lunch" on one screen and "Lunchtime" on another.
 */
import type { MealSlot } from '../types';
import { t } from './i18n';

/** "Breakfast", for a heading or a button. */
export function slotName(slot: MealSlot): string {
  return { breakfast: t('Breakfast'), lunch: t('Lunch'), dinner: t('Dinner'), snack: t('Snack') }[slot] ?? slot;
}

/** "breakfast", mid-sentence. */
export function slotWord(slot: MealSlot): string {
  return { breakfast: t('breakfast'), lunch: t('lunch'), dinner: t('dinner'), snack: t('snack') }[slot] ?? slot;
}

/** Steps as a small tile can hold them: 850, 2.5k, 12k. */
export function shortSteps(steps: number): string {
  if (steps < 1000) return steps.toLocaleString();
  const k = steps / 1000;
  return `${k < 10 ? Math.round(k * 10) / 10 : Math.round(k)}k`;
}
