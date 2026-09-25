/**
 * Achievements: what there is to earn, and working out from the diary which
 * of them somebody has.
 *
 * Grouped by the kind of thing they reward, which is also how Insights shows
 * them: showing up, eating well, variety, trying things out, and friends.
 *
 * What is deliberately not here: anything for eating under a target, for
 * weight lost, or for skipping a meal. In a food app those push towards
 * restriction, which is the one direction a nudge must never go. Weighing in
 * is rewarded for keeping track, never for the number.
 *
 * Streaks are kept, but are not the only way to show up: total days logged
 * and "welcome back" reward the person who misses days, who is exactly the
 * person a streak badge gives nothing to.
 *
 * Most badges are worked out here from the diary, so they are right however
 * it got that way — logged today, restored from a backup, or earned before
 * the badge existed. The few that are about using a feature (a first barcode
 * scan, say) leave no mark in the diary and are unlocked where that happens.
 */
import type { Achievement, DayLog, MealEntry, Targets } from '../types';
import { addDays, isoDate, weekOf } from './date';
import { addNutrients, EMPTY } from './nutrition';
import { bestStreak, dayScore } from './selectors';

export type AchievementGroup = 'showing-up' | 'eating-well' | 'variety' | 'trying' | 'friends';

export const ACHIEVEMENT_GROUPS: { id: AchievementGroup; title: string }[] = [
  { id: 'showing-up', title: 'Showing up' },
  { id: 'eating-well', title: 'Eating well' },
  { id: 'variety', title: 'Variety' },
  { id: 'trying', title: 'Trying things' },
  { id: 'friends', title: 'Friends' },
];

type Entry = Achievement & { group: AchievementGroup };
const a = (group: AchievementGroup, id: string, title: string, description: string, emoji: string): Entry => ({
  id,
  title,
  description,
  emoji,
  group,
});

/** In the order Insights shows them, group by group. Ids are stored — never rename one. */
export const ACHIEVEMENTS: Entry[] = [
  a('showing-up', 'first-meal', 'First bite', 'Log your very first meal', '🍽️'),
  a('showing-up', 'streak-3', 'Three in a row', 'Log meals three days running', '🔥'),
  a('showing-up', 'streak-7', 'Full week', 'Seven days of logging', '🗓️'),
  a('showing-up', 'days-10', 'Ten days', 'Log on ten days — any ten', '🔟'),
  a('showing-up', 'streak-14', 'Fortnight', 'Two weeks of logging', '🌿'),
  a('showing-up', 'streak-30', 'Squish regular', 'Thirty days of logging', '🏆'),
  a('showing-up', 'welcome-back', 'Welcome back', 'Log again after a week or more away', '👋'),
  a('showing-up', 'days-50', 'Fifty days', 'Log on fifty days in all', '🌟'),
  a('showing-up', 'streak-50', 'Half century', 'Fifty days of logging', '🎯'),
  a('showing-up', 'streak-100', 'Century', 'A hundred days of logging', '💯'),
  a('showing-up', 'streak-200', 'Two hundred', 'Two hundred days of logging', '🚀'),
  a('showing-up', 'days-250', 'Old friends', 'Log on 250 days in all', '💜'),
  a('showing-up', 'streak-365', 'A whole year', 'A year of logging', '🎂'),

  a('eating-well', 'protein-hit', 'Protein pro', 'Hit your protein target in a day', '💪'),
  a('eating-well', 'fibre-hit', 'Fibre friend', 'Hit your fibre target in a day', '🥦'),
  a('eating-well', 'hydrated', 'Well watered', 'Reach your water goal', '💧'),
  a('eating-well', 'balanced-day', 'Balanced day', 'Finish a day scoring 75+', '⭐'),
  a('eating-well', 'protein-week', 'Protein week', 'Hit your protein target on 5 days in one week', '🥚'),
  a('eating-well', 'balanced-3', 'Hat-trick', 'Three days in a row scoring 75+', '🎩'),
  a('eating-well', 'water-week', 'Hydration habit', 'Reach your water goal 7 days running', '🌊'),
  a('eating-well', 'fibre-30', 'Fibre fan', 'Hit your fibre target on 30 days', '🌾'),

  a('variety', 'full-day', 'Full day', 'Log breakfast, lunch and dinner in one day', '🍳'),
  a('variety', 'foods-25', 'Curious eater', 'Log 25 different foods', '🧺'),
  a('variety', 'foods-100', 'Adventurous eater', 'Log 100 different foods', '🌍'),

  a('trying', 'photo-10', 'Snap happy', 'Analyse ten meals from photos', '📸'),
  a('trying', 'first-scan', 'Beep!', 'Scan a barcode', '🏷️'),
  a('trying', 'first-voice', 'Say it', 'Log a meal by talking', '🎙️'),
  a('trying', 'first-recipe', 'Home cook', 'Import a recipe', '📖'),
  a('trying', 'first-question', 'Curious mind', 'Ask the nutritionist a question', '💬'),
  a('trying', 'weigh-4', 'Checking in', 'Weigh in four weeks in a row', '⚖️'),
  a('trying', 'first-share', 'Show and tell', 'Share a progress card', '📣'),

  a('friends', 'squad', 'Squad', 'A friend you invited got going', '🤝'),
  a('friends', 'squad-week', 'Squad goals', 'Your whole squad hit its week', '🏆'),
];

export const achievementById = (id: string): Entry | undefined => ACHIEVEMENTS.find((entry) => entry.id === id);

export interface Diary {
  meals: MealEntry[];
  days: Record<string, DayLog>;
  targets: Targets;
}

/** The longest run of consecutive dates in `dates` (sorted, unique) that pass `test`. */
function longestRun(dates: string[], test: (date: string) => boolean): number {
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of dates) {
    if (!test(date)) {
      run = 0;
      previous = null;
      continue;
    }
    run = previous !== null && addDays(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

/**
 * Every badge the diary shows somebody has earned. Only ever adds: a badge
 * once earned is kept, even if the meal that earned it is later deleted,
 * because taking a badge back is a small unkindness nobody asked for.
 */
export function earnedFrom({ meals, days, targets }: Diary, today = isoDate()): string[] {
  const earned: string[] = [];
  const add = (id: string, when: boolean) => {
    if (when) earned.push(id);
  };
  if (!meals.length && !Object.keys(days).length) return earned;

  const byDate = new Map<string, MealEntry[]>();
  for (const meal of meals) byDate.set(meal.date, [...(byDate.get(meal.date) ?? []), meal]);
  const dates = [...byDate.keys()].filter((date) => date <= today).sort();
  const totals = new Map(dates.map((date) => [date, byDate.get(date)!.reduce((acc, m) => addNutrients(acc, m.nutrients), { ...EMPTY })]));

  // Showing up.
  const best = bestStreak(meals.filter((m) => m.date <= today));
  add('first-meal', dates.length > 0);
  for (const n of [3, 7, 14, 30, 50, 100, 200, 365]) add(`streak-${n}`, best >= n);
  for (const n of [10, 50, 250]) add(`days-${n}`, dates.length >= n);
  add(
    'welcome-back',
    dates.some((date, i) => i > 0 && addDays(dates[i - 1], 8) <= date),
  );

  // Eating well. A day's score counts once the day is over: at lunchtime it
  // is a day's first meal, not a day.
  const proteinDay = (date: string) => (totals.get(date)?.protein ?? 0) >= targets.protein;
  const fibreDay = (date: string) => (totals.get(date)?.fibre ?? 0) >= targets.fibre;
  const finished = dates.filter((date) => date < today);
  const balanced = (date: string) => dayScore(meals, date, targets) >= 75;
  add('protein-hit', dates.some(proteinDay));
  add('fibre-hit', dates.some(fibreDay));
  add('balanced-day', finished.some(balanced));
  add('balanced-3', longestRun(finished, balanced) >= 3);
  add('fibre-30', dates.filter(fibreDay).length >= 30);

  const weeks = new Map<string, number>();
  for (const date of dates.filter(proteinDay)) {
    const monday = weekOf(date)[0];
    weeks.set(monday, (weeks.get(monday) ?? 0) + 1);
  }
  add('protein-week', [...weeks.values()].some((n) => n >= 5));

  const dayDates = Object.keys(days).filter((date) => date <= today).sort();
  const watered = (date: string) => (days[date]?.water ?? 0) >= targets.water;
  add('hydrated', dayDates.some(watered));
  add('water-week', longestRun(dayDates, watered) >= 7);

  // Weighing in: any four Monday-first weeks in a row with a weight in each.
  const weighWeeks = [...new Set(dayDates.filter((date) => days[date]?.weightKg).map((date) => weekOf(date)[0]))].sort();
  let weighRun = 0;
  let weighBest = 0;
  weighWeeks.forEach((monday, i) => {
    weighRun = i > 0 && addDays(weighWeeks[i - 1], 7) === monday ? weighRun + 1 : 1;
    weighBest = Math.max(weighBest, weighRun);
  });
  add('weigh-4', weighBest >= 4);

  // Variety.
  const foods = new Set(meals.flatMap((meal) => meal.items.map((item) => item.name.trim().toLowerCase())).filter(Boolean));
  add('foods-25', foods.size >= 25);
  add('foods-100', foods.size >= 100);
  add(
    'full-day',
    dates.some((date) => {
      const slots = new Set(byDate.get(date)!.map((m) => m.slot));
      return slots.has('breakfast') && slots.has('lunch') && slots.has('dinner');
    }),
  );

  return earned;
}
