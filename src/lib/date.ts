import { t, uiLocale } from './i18n';

export const DAY_MS = 86_400_000;

export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, delta: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY_MS);
}

/** Last `n` ISO dates ending at `end` (inclusive), oldest first. */
export function lastDays(n: number, end: string = isoDate()): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
}

/** Monday-first week containing `iso`. */
export function weekOf(iso: string): string[] {
  const d = parseISO(iso);
  const offset = (d.getDay() + 6) % 7;
  const monday = addDays(iso, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The day's initial in their language: M T W T F S S, L M M J V S D. */
export function weekdayLetter(iso: string): string {
  return parseISO(iso).toLocaleDateString(uiLocale(), { weekday: 'narrow' });
}

export function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short' });
}

export function friendlyDate(iso: string): string {
  const today = isoDate();
  if (iso === today) return t('Today');
  if (iso === addDays(today, -1)) return t('Yesterday');
  if (iso === addDays(today, 1)) return t('Tomorrow');
  return parseISO(iso).toLocaleDateString(uiLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

export function nowTime(): string {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function slotForNow(date: Date = new Date()): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const h = date.getHours();
  if (h < 10.5) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/** Which part of the day it is where the person is — for greetings, and for knowing when one has gone stale. */
export function partOfDay(date: Date = new Date()): PartOfDay {
  const h = date.getHours();
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

export function greeting(date: Date = new Date()): string {
  const part = partOfDay(date);
  if (part === 'morning') return t('Good morning!');
  if (part === 'afternoon') return t('Good afternoon!');
  return t('Good evening!');
}

/** "evening, 21:40" — the time as the coach is told it (in English: it is for the prompt, not the screen), so it never wishes anybody good morning at ten at night. */
export function timeOfDayWords(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const part = partOfDay(date);
  return `${part === 'night' ? 'late at night' : part}, ${hh}:${mm}`;
}
