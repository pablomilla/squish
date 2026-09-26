import { useMemo, useState } from 'react';
import { Sheet } from '../ui';
import { ChevronIcon } from '../icons';
import { isoDate, parseISO } from '../../lib/date';
import { firstLogged, monthGrid, monthMarks, stepMonth } from '../../lib/diaryNav';
import { useSquish } from '../../store/useSquish';
import { plural, t, uiLocale } from '../../lib/i18n';

/** Monday to Sunday, as their language writes each day's initial: 5 Jan 2026 was a Monday. */
const weekdays = () => Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 5 + i).toLocaleDateString(uiLocale(), { weekday: 'narrow' }));

/**
 * Any day in the diary, a month at a time: a dot on each day something was
 * logged and a star on the 75+ ones, arrows between months, a jump to any
 * year, and Today. Nothing before the first meal or after today can be
 * picked — there is nothing to see there.
 */
export default function CalendarSheet({ open, date, onClose, onPick }: { open: boolean; date: string; onClose: () => void; onPick: (date: string) => void }) {
  const meals = useSquish((s) => s.meals);
  const targets = useSquish((s) => s.targets);
  const today = isoDate();
  const first = useMemo(() => firstLogged(meals, today), [meals, today]);
  const shown = parseISO(date);
  const [[year, month], setMonth] = useState<[number, number]>([shown.getFullYear(), shown.getMonth()]);

  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  const marks = useMemo(() => monthMarks(meals, year, month, targets), [meals, year, month, targets]);
  const monthKey = (y: number, m: number) => y * 12 + m;
  const firstDate = parseISO(first);
  const canBack = monthKey(year, month) > monthKey(firstDate.getFullYear(), firstDate.getMonth());
  const canForward = monthKey(year, month) < monthKey(new Date().getFullYear(), new Date().getMonth());
  const years = Array.from({ length: new Date().getFullYear() - firstDate.getFullYear() + 1 }, (_, i) => firstDate.getFullYear() + i);
  const label = new Date(year, month, 1).toLocaleDateString(uiLocale(), { month: 'long', year: 'numeric' });
  const logged = marks.size;

  const pick = (d: string) => {
    onPick(d);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('Go to a day')}>
      <div className="calendar">
        <div className="calendar-head">
          <button type="button" className="icon-btn" disabled={!canBack} onClick={() => setMonth(stepMonth(year, month, -1))} aria-label={t('Previous month')}>
            <ChevronIcon size={20} className="flip" />
          </button>
          <b aria-live="polite">{label}</b>
          <button type="button" className="icon-btn" disabled={!canForward} onClick={() => setMonth(stepMonth(year, month, 1))} aria-label={t('Next month')}>
            <ChevronIcon size={20} />
          </button>
        </div>

        {years.length > 1 && (
          <div className="calendar-years" role="group" aria-label={t('Year')}>
            {years.map((y) => (
              <button
                key={y}
                type="button"
                aria-pressed={y === year}
                className="calendar-year"
                onClick={() => {
                  // Same month in that year, kept inside the diary's span.
                  const target = Math.min(Math.max(monthKey(y, month), monthKey(firstDate.getFullYear(), firstDate.getMonth())), monthKey(new Date().getFullYear(), new Date().getMonth()));
                  setMonth([Math.floor(target / 12), target % 12]);
                }}
              >
                {y}
              </button>
            ))}
          </div>
        )}

        <div className="calendar-grid" role="grid" aria-label={label}>
          {weekdays().map((d, i) => (
            <span key={i} className="calendar-weekday tiny muted" aria-hidden="true">
              {d}
            </span>
          ))}
          {weeks.flat().map((d, i) => {
            if (!d) return <span key={`blank-${i}`} />;
            const mark = marks.get(d);
            const out = d > today || d < first;
            return (
              <button
                key={d}
                type="button"
                disabled={out}
                className={`calendar-day${d === date ? ' is-on' : ''}${d === today ? ' is-today' : ''}`}
                onClick={() => pick(d)}
                aria-label={
                  mark === 'great'
                    ? t('{date}, logged, a 75+ day', { date: parseISO(d).toLocaleDateString(uiLocale(), { weekday: 'long', day: 'numeric', month: 'long' }) })
                    : mark
                      ? t('{date}, logged', { date: parseISO(d).toLocaleDateString(uiLocale(), { weekday: 'long', day: 'numeric', month: 'long' }) })
                      : parseISO(d).toLocaleDateString(uiLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
                }
              >
                {Number(d.slice(-2))}
                <span className={`calendar-mark${mark ? ` calendar-mark--${mark}` : ''}`} aria-hidden="true">
                  {mark === 'great' ? '★' : ''}
                </span>
              </button>
            );
          })}
        </div>

        <div className="calendar-foot">
          <span className="tiny muted">
            {logged
              ? plural(logged, { one: 'Logged on {n} day this month · ★ a 75+ day', other: 'Logged on {n} days this month · ★ a 75+ day' })
              : t('Nothing logged this month.')}
          </span>
          <button type="button" className="btn btn--sm btn--soft" onClick={() => pick(today)}>
            {t('Today')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
