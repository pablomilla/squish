/**
 * Calendar weeks and months for Insights, stepped back from the current one:
 * offset 0 is this week (Monday to Sunday) or this month, 1 the one before,
 * and so on. Worked out here, away from the screen, so it can be tested.
 */
import { addDays, daysBetween, parseISO, shortDate, weekOf } from './date';
import { daysIn } from './birthday';
import { t, uiLocale } from './i18n';

export type PeriodGrain = 'week' | 'month';

/** Year and month (1–12) `offset` months before the one `today` is in. */
function monthBack(today: string, offset: number): { y: number; m: number } {
  const [y, m] = today.split('-').map(Number);
  const index = y * 12 + (m - 1) - offset;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

/** Every day of the period, first to last, including any still to come. */
export function periodDays(grain: PeriodGrain, offset: number, today: string): string[] {
  if (grain === 'week') return weekOf(addDays(weekOf(today)[0], -7 * offset));
  const { y, m } = monthBack(today, offset);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  return Array.from({ length: daysIn(y, m) }, (_, i) => addDays(first, i));
}

/** How far back the arrows go: to the period with the first meal in it, and never forward of now. */
export function earliestOffset(grain: PeriodGrain, firstDate: string | undefined, today: string): number {
  if (!firstDate || firstDate >= today) return 0;
  if (grain === 'week') return Math.floor(daysBetween(weekOf(firstDate)[0], weekOf(today)[0]) / 7);
  const [fy, fm] = firstDate.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** "This week", "Last week", "15 Sept – 21 Sept"; "This month", "Last month", "August", "August 2025". */
export function periodLabel(grain: PeriodGrain, offset: number, today: string): string {
  if (grain === 'week') {
    if (offset === 0) return t('This week');
    if (offset === 1) return t('Last week');
    const days = periodDays('week', offset, today);
    return t('{from} – {to}', { from: shortDate(days[0]), to: shortDate(days[6]) });
  }
  if (offset === 0) return t('This month');
  if (offset === 1) return t('Last month');
  const { y, m } = monthBack(today, offset);
  const date = parseISO(`${y}-${String(m).padStart(2, '0')}-01`);
  return date.toLocaleDateString(uiLocale(), y === Number(today.slice(0, 4)) ? { month: 'long' } : { month: 'long', year: 'numeric' });
}
