import type { Activity, FoodItem, MacroKey, Nutrients, Profile, Targets } from '../types';

export const EMPTY: Nutrients = { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0, sodium: 0 };

const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

export const ACTIVITY_LABEL: Record<Activity, string> = {
  sedentary: 'Mostly sitting',
  light: 'Lightly active',
  moderate: 'Moderately active',
  active: 'Very active',
  athlete: 'Athlete',
};

export const MACRO_LABEL: Record<MacroKey, string> = {
  protein: 'Protein',
  carbs: 'Carbs',
  fat: 'Fat',
  fibre: 'Fibre',
};

/** kcal per gram — fibre is counted inside carbs, so it is not double-counted. */
export const MACRO_KCAL: Record<MacroKey, number> = { protein: 4, carbs: 4, fat: 9, fibre: 0 };

/** Mifflin-St Jeor basal metabolic rate. */
export function bmr(p: Pick<Profile, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  if (p.sex === 'male') return base + 5;
  if (p.sex === 'female') return base - 161;
  return base - 78;
}

export function tdee(p: Profile): number {
  return bmr(p) * ACTIVITY_FACTOR[p.activity];
}

/** Daily calorie + macro targets, Yazio-style: pace converted to a kcal delta. */
export function computeTargets(p: Profile): Targets {
  const maintenance = tdee(p);
  const paceDelta = (Math.min(Math.abs(p.pace), 1) * 7700) / 7; // 7700 kcal ≈ 1 kg
  let calories = maintenance;
  if (p.goal === 'lose') calories = maintenance - paceDelta;
  if (p.goal === 'gain') calories = maintenance + paceDelta;

  // Never prescribe below a safe floor.
  const floor = p.sex === 'male' ? 1500 : 1200;
  calories = Math.max(floor, Math.round(calories / 10) * 10);

  const proteinPerKg = p.goal === 'lose' ? 1.8 : p.goal === 'gain' ? 1.9 : 1.6;
  const protein = Math.round(proteinPerKg * Math.min(p.weightKg, p.targetWeightKg + 25));
  const fat = Math.round((calories * 0.28) / 9);
  const carbs = Math.max(60, Math.round((calories - protein * 4 - fat * 9) / 4));
  const fibre = Math.round((calories / 1000) * 14);

  return {
    calories,
    protein,
    carbs,
    fat,
    fibre,
    sugar: Math.round((calories * 0.1) / 4),
    sodium: 2300,
    water: Math.max(6, Math.round((p.weightKg * 33) / 250)), // 250 ml glasses
    steps: p.activity === 'sedentary' ? 6000 : p.activity === 'light' ? 8000 : 10000,
  };
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  // Rounded as we go: gram totals are estimates, and float noise like 40.99999
  // has no business reaching the UI.
  return {
    calories: Math.round(a.calories + b.calories),
    protein: round1(a.protein + b.protein),
    carbs: round1(a.carbs + b.carbs),
    fat: round1(a.fat + b.fat),
    fibre: round1(a.fibre + b.fibre),
    sugar: round1((a.sugar ?? 0) + (b.sugar ?? 0)),
    sodium: Math.round((a.sodium ?? 0) + (b.sodium ?? 0)),
  };
}

export function sumNutrients(list: { nutrients: Nutrients }[]): Nutrients {
  return list.reduce((acc, x) => addNutrients(acc, x.nutrients), { ...EMPTY });
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  return {
    calories: Math.round(n.calories * factor),
    protein: round1(n.protein * factor),
    carbs: round1(n.carbs * factor),
    fat: round1(n.fat * factor),
    fibre: round1(n.fibre * factor),
    sugar: round1((n.sugar ?? 0) * factor),
    sodium: Math.round((n.sodium ?? 0) * factor),
  };
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Share of calories coming from each macro, as fractions that sum to 1. */
export function macroSplit(n: Nutrients): Record<'protein' | 'carbs' | 'fat', number> {
  const p = n.protein * 4;
  const c = n.carbs * 4;
  const f = n.fat * 9;
  const total = p + c + f;
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: p / total, carbs: c / total, fat: f / total };
}

/**
 * Diet-quality score, 0–100. Rewards protein and fibre density, penalises
 * heavy sugar, saturated-ish fat load and sodium. Used when the model does not
 * return one of its own.
 */
export function qualityScore(n: Nutrients): number {
  if (n.calories <= 0) return 0;
  const per1000 = (v: number) => (v / n.calories) * 1000;
  let score = 52;
  score += Math.min(22, per1000(n.protein) * 0.42);
  score += Math.min(18, per1000(n.fibre) * 1.5);
  score -= Math.min(20, Math.max(0, per1000(n.sugar ?? 0) - 12) * 0.6);
  score -= Math.min(14, Math.max(0, per1000(n.fat) - 42) * 0.5);
  score -= Math.min(10, Math.max(0, per1000(n.sodium ?? 0) - 900) / 90);
  return Math.max(1, Math.min(100, Math.round(score)));
}

export function scoreLabel(score: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (score >= 75) return { label: 'Brilliant', tone: 'good' };
  if (score >= 55) return { label: 'Balanced', tone: 'good' };
  if (score >= 38) return { label: 'So-so', tone: 'warn' };
  return { label: 'Heavy', tone: 'bad' };
}

export function itemsTotal(items: FoodItem[]): Nutrients {
  return sumNutrients(items);
}

export function kcalOf(n: Nutrients): number {
  return Math.round(n.protein * 4 + n.carbs * 4 + n.fat * 9);
}

/** Estimates grams remaining before a target, never negative. */
export function remaining(target: number, current: number): number {
  return Math.max(0, Math.round(target - current));
}

export function pct(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(1.5, current / target);
}

export function kg(lbOrKg: number, units: 'metric' | 'imperial'): string {
  return units === 'metric' ? `${round1(lbOrKg)} kg` : `${Math.round(lbOrKg * 2.20462)} lb`;
}

export function cm(value: number, units: 'metric' | 'imperial'): string {
  if (units === 'metric') return `${Math.round(value)} cm`;
  const inches = value / 2.54;
  return `${Math.floor(inches / 12)}′${Math.round(inches % 12)}″`;
}
