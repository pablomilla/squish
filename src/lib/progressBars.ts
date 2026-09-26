/**
 * The bars on "Your progress", for each range.
 *
 * A week is seven days, a month is thirty, and all time is all of it — too
 * many days for a bar each, so those become weeks, or months once there is
 * more than half a year. A week's or month's bar is the average over the days
 * that were logged: a week with two logged days is two days' eating, not five
 * days of nothing dragging it down.
 */
import type { DaySeriesPoint } from './selectors';
import { addDays, parseISO, weekdayLetter } from './date';
import { t, uiLocale } from './i18n';

export type Range = '7' | '30' | 'all';
export type Grain = 'day' | 'week' | 'month';

export interface BarPoint extends DaySeriesPoint {
  /** Under the bar. Empty where labelling every bar would crowd them. */
  label: string;
  /** What the bar is, in full: for the tooltip, the screen reader and the table. */
  title: string;
}

/** Past this many days, all time is shown by the month rather than the week. */
const WEEKS_UP_TO_DAYS = 26 * 7;

/** "21 Sep", the British way round, whatever language the browser is set to. */
const shortDate = (iso: string) => parseISO(iso).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short' });
const monthShort = (iso: string) => parseISO(iso).toLocaleDateString(uiLocale(), { month: 'short' });
const monthLong = (iso: string) => parseISO(iso).toLocaleDateString(uiLocale(), { month: 'long', year: 'numeric' });
const dayLong = (iso: string) => parseISO(iso).toLocaleDateString(uiLocale(), { weekday: 'short', day: 'numeric', month: 'short' });

/** The Monday a date's week starts on. */
function mondayOf(iso: string): string {
  const d = parseISO(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}

/** Average over the logged days of a group; the group counts as logged if any day was. */
function average(date: string, days: DaySeriesPoint[]): DaySeriesPoint {
  const logged = days.filter((d) => d.logged);
  const avg = (pick: (d: DaySeriesPoint) => number, places = 0) => {
    if (!logged.length) return 0;
    const f = 10 ** places;
    return Math.round((logged.reduce((s, d) => s + pick(d), 0) / logged.length) * f) / f;
  };
  return {
    date,
    calories: avg((d) => d.calories),
    protein: avg((d) => d.protein),
    carbs: avg((d) => d.carbs),
    fat: avg((d) => d.fat),
    fibre: avg((d) => d.fibre),
    sugar: avg((d) => d.sugar),
    salt: avg((d) => d.salt, 1),
    score: avg((d) => d.score),
    logged: logged.length > 0,
  };
}

function groupBy(points: DaySeriesPoint[], keyOf: (iso: string) => string): [string, DaySeriesPoint[]][] {
  const groups = new Map<string, DaySeriesPoint[]>();
  for (const p of points) {
    const key = keyOf(p.date);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()];
}

/** Every nth label, counted back from the newest so the latest bar is always named. */
const everyNth = (index: number, count: number, n: number) => (count - 1 - index) % n === 0;

export function progressBars(points: DaySeriesPoint[], range: Range): { grain: Grain; bars: BarPoint[] } {
  if (range === '7') {
    return { grain: 'day', bars: points.map((p) => ({ ...p, label: weekdayLetter(p.date), title: dayLong(p.date) })) };
  }
  if (range === '30') {
    return {
      grain: 'day',
      bars: points.map((p, i) => ({ ...p, label: everyNth(i, points.length, 7) ? shortDate(p.date) : '', title: dayLong(p.date) })),
    };
  }

  if (points.length <= WEEKS_UP_TO_DAYS) {
    const weeks = groupBy(points, mondayOf);
    const step = weeks.length > 12 ? 4 : weeks.length > 6 ? 2 : 1;
    return {
      grain: 'week',
      bars: weeks.map(([monday, days], i) => ({
        ...average(monday, days),
        label: everyNth(i, weeks.length, step) ? shortDate(monday) : '',
        title: t('Week of {date}', { date: shortDate(monday) }),
      })),
    };
  }

  const months = groupBy(points, (iso) => iso.slice(0, 7));
  const step = months.length > 18 ? 3 : months.length > 9 ? 2 : 1;
  return {
    grain: 'month',
    bars: months.map(([month, days], i) => ({
      ...average(`${month}-01`, days),
      label: everyNth(i, months.length, step) ? monthShort(`${month}-01`) : '',
      title: monthLong(`${month}-01`),
    })),
  };
}
