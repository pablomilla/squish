import type { DayLog, MealEntry, MacroKey, Mood, Nutrients, Targets } from '../types';
import { EMPTY, addNutrients, pct, qualityScore } from './nutrition';
import { addDays, isoDate, lastDays } from './date';

export function mealsOn(meals: MealEntry[], date: string): MealEntry[] {
  return meals.filter((m) => m.date === date).sort((a, b) => a.time.localeCompare(b.time));
}

export function totalsOn(meals: MealEntry[], date: string): Nutrients {
  return mealsOn(meals, date).reduce((acc, m) => addNutrients(acc, m.nutrients), { ...EMPTY });
}

/** Weighted day score — a big meal moves it more than a coffee. */
export function dayScore(meals: MealEntry[], date: string): number {
  const list = mealsOn(meals, date);
  if (!list.length) return 0;
  const weight = list.reduce((sum, m) => sum + Math.max(60, m.nutrients.calories), 0);
  const weighted = list.reduce((sum, m) => sum + m.score * Math.max(60, m.nutrients.calories), 0);
  return Math.round(weighted / weight);
}

export interface HabitState {
  meals: boolean;
  protein: boolean;
  water: boolean;
  movement: boolean;
}

export function habitsOn(
  meals: MealEntry[],
  days: Record<string, DayLog>,
  targets: Targets,
  date: string,
): HabitState {
  const totals = totalsOn(meals, date);
  const day = days[date];
  return {
    meals: mealsOn(meals, date).length >= 3,
    protein: totals.protein >= targets.protein * 0.9,
    water: (day?.water ?? 0) >= targets.water,
    movement: (day?.steps ?? 0) >= targets.steps,
  };
}

export function habitCount(h: HabitState): number {
  return Number(h.meals) + Number(h.protein) + Number(h.water) + Number(h.movement);
}

/** Consecutive days with at least one meal, counting back from today. */
export function streakOf(meals: MealEntry[], today = isoDate()): number {
  const logged = new Set(meals.map((m) => m.date));
  let streak = 0;
  let cursor = logged.has(today) ? today : addDays(today, -1);
  while (logged.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function bestStreak(meals: MealEntry[]): number {
  const dates = [...new Set(meals.map((m) => m.date))].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of dates) {
    run = previous && addDays(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

export interface DaySeriesPoint {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  score: number;
  logged: boolean;
}

export function series(meals: MealEntry[], dates: string[]): DaySeriesPoint[] {
  return dates.map((date) => {
    const totals = totalsOn(meals, date);
    return {
      date,
      calories: Math.round(totals.calories),
      protein: Math.round(totals.protein),
      carbs: Math.round(totals.carbs),
      fat: Math.round(totals.fat),
      fibre: Math.round(totals.fibre),
      score: dayScore(meals, date),
      logged: totals.calories > 0,
    };
  });
}

export interface RangeSummary {
  days: number;
  loggedDays: number;
  avgCalories: number;
  avgProtein: number;
  avgFibre: number;
  avgScore: number;
  onTargetDays: number;
  bestDay?: DaySeriesPoint;
}

export function summarise(points: DaySeriesPoint[], targets: Targets): RangeSummary {
  const logged = points.filter((p) => p.logged);
  const avg = (pick: (p: DaySeriesPoint) => number) =>
    logged.length ? Math.round(logged.reduce((s, p) => s + pick(p), 0) / logged.length) : 0;

  return {
    days: points.length,
    loggedDays: logged.length,
    avgCalories: avg((p) => p.calories),
    avgProtein: avg((p) => p.protein),
    avgFibre: avg((p) => p.fibre),
    avgScore: avg((p) => p.score),
    onTargetDays: logged.filter((p) => Math.abs(p.calories - targets.calories) <= targets.calories * 0.1).length,
    bestDay: logged.slice().sort((a, b) => b.score - a.score)[0],
  };
}

export interface WeightPoint {
  date: string;
  weightKg: number;
}

export function weightSeries(days: Record<string, DayLog>, count = 90): WeightPoint[] {
  return lastDays(count)
    .map((date) => ({ date, weightKg: days[date]?.weightKg ?? 0 }))
    .filter((p): p is WeightPoint => p.weightKg > 0);
}

/** Which macro is furthest behind its target right now. */
export function weakestMacro(totals: Nutrients, targets: Targets): MacroKey {
  const keys: MacroKey[] = ['protein', 'fibre', 'carbs', 'fat'];
  return keys.reduce((worst, key) =>
    pct(totals[key], targets[key]) < pct(totals[worst], targets[worst]) ? key : worst,
  );
}

/** Pick the mascot mood that matches the moment. */
export function moodFor(options: {
  hour: number;
  mealsToday: number;
  caloriesPct: number;
  habits: number;
  streak: number;
  justLogged?: boolean;
}): Mood {
  const { hour, mealsToday, caloriesPct, habits, streak, justLogged } = options;
  if (justLogged) return 'nomnom';
  if (hour >= 22 || hour < 6) return 'sleepy';
  if (habits >= 4) return 'cheering';
  if (caloriesPct >= 0.9 && caloriesPct <= 1.08 && mealsToday >= 3) return 'proud';
  if (streak >= 3 && mealsToday > 0) return 'excited';
  if (mealsToday === 0) return 'calm';
  return 'excited';
}

/**
 * The line under the greeting. It reports the day, so it has to be true — the
 * mascot's own captions ("You hit your goal!") were being shown regardless of
 * whether any goal had been hit.
 */
export function statusLine(options: {
  mealsToday: number;
  caloriesPct: number;
  habits: number;
  streak: number;
  hour: number;
}): string {
  const { mealsToday, caloriesPct, habits, streak, hour } = options;
  if (habits >= 4) return "Every habit ticked off. You've got this!";
  if (caloriesPct >= 0.9 && caloriesPct <= 1.08 && mealsToday >= 3) return 'Right on target today!';
  if (caloriesPct > 1.15) return 'Over today — tomorrow is a fresh start.';
  if (mealsToday === 0) return hour >= 20 ? 'Nothing logged yet today.' : 'Ready when you are.';
  if (streak >= 3) return `Day ${streak} of your streak — nice going!`;
  if (mealsToday >= 3) return 'Three meals in. Lovely.';
  return "You're doing great.";
}

export function scoreOfItems(nutrients: Nutrients): number {
  return qualityScore(nutrients);
}
