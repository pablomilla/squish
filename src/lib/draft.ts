import type { Draft, MealEntry } from '../types';

/** A meal in the diary, opened again in Review to change it. */
export function draftOf(meal: MealEntry): Draft {
  return {
    analysis: {
      title: meal.title,
      items: meal.items,
      nutrients: meal.nutrients,
      score: meal.score,
      coachNote: meal.coachNote ?? '',
      confidence: meal.aiConfidence ?? 'medium',
      slot: meal.slot,
    },
    photo: meal.photo,
    slot: meal.slot,
    date: meal.date,
    editingId: meal.id,
  };
}
