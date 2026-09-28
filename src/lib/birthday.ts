/**
 * A date of birth, and the age it makes today.
 *
 * Asked for in onboarding on a wheel rather than as an age, so that the age
 * the energy formula uses goes up on its own on their birthday instead of
 * staying whatever they typed the day they joined. Stored as yyyy-mm-dd, on
 * the device and in their backup, like the rest of the profile.
 */

/** Whole years old on `today`: a birthday counts from the morning of it. */
export function ageOn(birthDate: string, today: Date = new Date()): number {
  const [year, month, day] = birthDate.split('-').map(Number);
  let age = today.getFullYear() - year;
  const before = today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  if (before) age -= 1;
  return age;
}

/** Days in a month (1–12) of a year, leap years included. */
export const daysIn = (year: number, month: number): number => new Date(year, month, 0).getDate();

const pad = (n: number) => String(n).padStart(2, '0');

/** A date from its parts, the day brought within the month (31 February is the 28th, or 29th). */
export function birthDateOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysIn(year, month)))}`;
}

/** Where the wheel starts for somebody who has not said: 1 January, `age` years ago. */
export const startingBirthDate = (age: number, today: Date = new Date()): string => `${today.getFullYear() - age}-01-01`;

export const isBirthDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
