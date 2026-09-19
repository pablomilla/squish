export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type Mood =
  | 'excited'
  | 'nomnom'
  | 'calm'
  | 'sleepy'
  | 'proud'
  | 'cheering'
  | 'thinking';

/** Macro keys in their fixed display order — the chart palette is keyed to this order. */
export const MACROS = ['protein', 'carbs', 'fat', 'fibre'] as const;
export type MacroKey = (typeof MACROS)[number];

export interface Nutrients {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  sugar?: number;
  sodium?: number;
}

export interface FoodItem {
  id: string;
  name: string;
  emoji?: string;
  /** What the portion was, in words: "1 bowl". The weight is shown from `grams`. */
  portion: string;
  grams?: number;
  /** Measured by volume rather than weight — a drink, a soup, a sauce. */
  liquid?: boolean;
  nutrients: Nutrients;
}

export interface MealEntry {
  id: string;
  /** ISO date, yyyy-mm-dd. */
  date: string;
  time: string;
  slot: MealSlot;
  title: string;
  items: FoodItem[];
  nutrients: Nutrients;
  /** 0–100 diet-quality score. */
  score: number;
  note?: string;
  coachNote?: string;
  photo?: string;
  source: 'photo' | 'describe' | 'search' | 'manual' | 'favourite';
  aiConfidence?: 'high' | 'medium' | 'low';
}

export interface DayLog {
  date: string;
  water: number;
  steps: number;
  weightKg?: number;
  moodNote?: string;
}

export type Goal = 'lose' | 'maintain' | 'gain';
export type Sex = 'female' | 'male' | 'other';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'athlete';

export interface Profile {
  name: string;
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  activity: Activity;
  goal: Goal;
  /** kg per week, positive magnitude. */
  pace: number;
  units: 'metric' | 'imperial';
  onboarded: boolean;
  /**
   * What their own logs say about their metabolism, as a multiple of the
   * textbook estimate. 1 until there is enough data to say otherwise, and
   * only ever changed with their say-so.
   */
  burnFactor?: number;
}

export interface Targets extends Nutrients {
  water: number;
  steps: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  emoji: string;
  unlockedOn?: string;
}

export interface AnalysisResult {
  title: string;
  slot?: MealSlot;
  items: FoodItem[];
  nutrients: Nutrients;
  score: number;
  coachNote: string;
  confidence: 'high' | 'medium' | 'low';
  /** True when the local estimator answered instead of Claude. */
  offline?: boolean;
}
