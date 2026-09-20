import type { DayLog, FoodItem, MealEntry, MacroKey, Mood, Nutrients, Targets } from '../types';
import { EMPTY, UNSCORED, addNutrients, overPenalty, overTargets, pct, qualityScore, sumNutrients, ultraProcessedShare } from './nutrition';
import { addDays, isoDate, lastDays } from './date';
import { saltGrams } from './units';

export function mealsOn(meals: MealEntry[], date: string): MealEntry[] {
  return meals.filter((m) => m.date === date).sort((a, b) => a.time.localeCompare(b.time));
}

export function totalsOn(meals: MealEntry[], date: string): Nutrients {
  return mealsOn(meals, date).reduce((acc, m) => addNutrients(acc, m.nutrients), { ...EMPTY });
}

/**
 * Weighted day score — a big meal moves it more than a coffee — less whatever
 * the day went badly over on.
 *
 * Meals with no calories sit it out entirely rather than scoring nought:
 * counting them dragged the day down, so logging a glass of water cost you
 * several points off a day you had eaten well.
 *
 * The targets only enter here. Every meal on a day can be a sensible thing to
 * eat and the day still be nothing like the day that was planned — three of
 * them, each scoring well, put 190 g of fat against a 65 g target. That is the
 * day's doing rather than any one meal's, which is why no meal is marked down
 * for it and the day is.
 */
export function dayScore(meals: MealEntry[], date: string, targets: Targets): number {
  const list = mealsOn(meals, date).filter((m) => m.nutrients.calories > 0);
  if (!list.length) return UNSCORED;
  const weight = list.reduce((sum, m) => sum + Math.max(60, m.nutrients.calories), 0);
  const weighted = list.reduce((sum, m) => sum + m.score * Math.max(60, m.nutrients.calories), 0);
  const composition = Math.round(weighted / weight);

  // Floored at 1, never 0: nought is the app's word for "nothing to score",
  // and a day that was eaten is never that.
  return Math.max(1, composition - overPenalty(overTargets(totalsOn(meals, date), targets)));
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

/** How many days in a range each habit was met — the "4 of 7" on the week card. */
export function habitTally(
  meals: MealEntry[],
  days: Record<string, DayLog>,
  targets: Targets,
  dates: string[],
): Record<keyof HabitState, number> {
  return dates.reduce(
    (tally, date) => {
      const met = habitsOn(meals, days, targets, date);
      return {
        meals: tally.meals + Number(met.meals),
        protein: tally.protein + Number(met.protein),
        water: tally.water + Number(met.water),
        movement: tally.movement + Number(met.movement),
      };
    },
    { meals: 0, protein: 0, water: 0, movement: 0 },
  );
}

export function habitCount(h: HabitState): number {
  return Number(h.meals) + Number(h.protein) + Number(h.water) + Number(h.movement);
}

/**
 * Days logged, counting back from today, forgiving the odd missed day.
 *
 * A streak ends when two days in a row go unlogged — one on its own does not
 * undo weeks of work, which is the whole point of a streak. Only days that
 * were actually logged are counted, so a skipped day is forgiven rather than
 * awarded: log Monday, Tuesday and Thursday and the streak is three, not four.
 */
export function streakOf(meals: MealEntry[], today = isoDate()): number {
  const logged = new Set(meals.map((m) => m.date));
  let streak = 0;
  // Today counts against nobody until it is over.
  let cursor = logged.has(today) ? today : addDays(today, -1);

  while (true) {
    if (logged.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    } else if (streak > 0 && logged.has(addDays(cursor, -1))) {
      cursor = addDays(cursor, -1); // Step over the one missed day.
    } else {
      return streak;
    }
  }
}

/** Was the streak kept alive across a missed day? Worth saying kindly. */
export function streakForgaveADay(meals: MealEntry[], today = isoDate()): boolean {
  const logged = new Set(meals.map((m) => m.date));
  let cursor = logged.has(today) ? today : addDays(today, -1);
  let seen = 0;

  while (true) {
    if (logged.has(cursor)) {
      seen += 1;
      cursor = addDays(cursor, -1);
    } else if (seen > 0 && logged.has(addDays(cursor, -1))) {
      return true;
    } else {
      return false;
    }
  }
}

/** The longest run ever, under the same forgiving rule. */
export function bestStreak(meals: MealEntry[]): number {
  const dates = [...new Set(meals.map((m) => m.date))].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;

  for (const date of dates) {
    const carriesOn = previous !== null && (addDays(previous, 1) === date || addDays(previous, 2) === date);
    run = carriesOn ? run + 1 : 1;
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
  sugar: number;
  /** Salt, in grams — what a label says, not the sodium underneath it. */
  salt: number;
  score: number;
  logged: boolean;
}

export function series(meals: MealEntry[], dates: string[], targets: Targets): DaySeriesPoint[] {
  return dates.map((date) => {
    const totals = totalsOn(meals, date);
    return {
      date,
      calories: Math.round(totals.calories),
      protein: Math.round(totals.protein),
      carbs: Math.round(totals.carbs),
      fat: Math.round(totals.fat),
      fibre: Math.round(totals.fibre),
      sugar: Math.round(totals.sugar ?? 0),
      salt: saltGrams(totals.sodium ?? 0),
      score: dayScore(meals, date, targets),
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
  avgSugar: number;
  /** Grams of salt, to one decimal — 4 g and 4.4 g are not the same advice. */
  avgSalt: number;
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
    avgSugar: avg((p) => p.sugar),
    avgSalt: logged.length ? Math.round((logged.reduce((s, p) => s + p.salt, 0) / logged.length) * 10) / 10 : 0,
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

export function scoreOfItems(items: FoodItem[]): number {
  return qualityScore(sumNutrients(items), ultraProcessedShare(items));
}
