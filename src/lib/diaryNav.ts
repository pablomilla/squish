/**
 * Getting around a long diary: a month calendar to jump to any day, and a
 * search for "when did I last have that?".
 *
 * The date strip on the diary only covers the last fortnight, which is where
 * almost everybody looks. Past it, the only way back was a day at a time —
 * ninety taps to reach three months ago. Both of these are worked out on the
 * phone from the diary it already holds; nothing is sent anywhere.
 */
import { addDays, isoDate, parseISO } from './date';
import { dayScore } from './selectors';
import type { MealEntry, Targets } from '../types';

/** A month as Monday-first weeks; days outside the month are null. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = isoDate(new Date(year, month, 1));
  const lead = (parseISO(first).getDay() + 6) % 7;
  const length = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Step a month forwards or back, as [year, month] with month 0–11. */
export function stepMonth(year: number, month: number, delta: number): [number, number] {
  const d = new Date(year, month + delta, 1);
  return [d.getFullYear(), d.getMonth()];
}

/** The earliest day anything was logged, or today when nothing has been. */
export function firstLogged(meals: MealEntry[], today = isoDate()): string {
  let first = today;
  for (const meal of meals) if (meal.date < first) first = meal.date;
  return first;
}

export type DayMark = 'logged' | 'great' | null;

/**
 * A mark for each logged day of a month: logged, or a 75+ day worth a star.
 * Deliberately no mark for a poor day — a calendar of red dots is a record
 * of failure, and the diary is there for somebody to come back to.
 */
export function monthMarks(meals: MealEntry[], year: number, month: number, targets: Targets): Map<string, DayMark> {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const inMonth = meals.filter((m) => m.date.startsWith(prefix));
  const marks = new Map<string, DayMark>();
  for (const date of new Set(inMonth.map((m) => m.date))) {
    marks.set(date, dayScore(inMonth, date, targets) >= 75 ? 'great' : 'logged');
  }
  return marks;
}

/** Lower case, without accents, so "creme" finds "Crème brûlée". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export interface SearchHit {
  meal: MealEntry;
  /** Items in the meal that matched, when it was not the title. */
  items: string[];
}

/**
 * Meals whose title or items contain every word searched for, newest first.
 * "chicken rice" finds a chicken and rice dinner, not every meal with either.
 */
export function searchMeals(meals: MealEntry[], query: string, limit = 60): SearchHit[] {
  const words = fold(query).split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const meal of meals) {
    const title = fold(meal.title);
    const names = meal.items.map((item) => item.name);
    const everything = `${title} ${names.map(fold).join(' ')}`;
    if (!words.every((w) => everything.includes(w))) continue;
    hits.push({ meal, items: title.includes(words[0]) && words.every((w) => title.includes(w)) ? [] : names.filter((n) => words.some((w) => fold(n).includes(w))) });
  }
  hits.sort((a, b) => (b.meal.date + b.meal.time).localeCompare(a.meal.date + a.meal.time));
  return hits.slice(0, limit);
}
