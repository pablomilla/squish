import { useMemo, useState } from 'react';
import { Sheet } from '../ui';
import { ChevronIcon } from '../icons';
import { isoDate, parseISO } from '../../lib/date';
import { firstLogged, monthGrid, monthMarks, stepMonth } from '../../lib/diaryNav';
import { useSquish } from '../../store/useSquish';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

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
  const label = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const logged = marks.size;

  const pick = (d: string) => {
    onPick(d);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Go to a day">
      <div className="calendar">
        <div className="calendar-head">
          <button type="button" className="icon-btn" disabled={!canBack} onClick={() => setMonth(stepMonth(year, month, -1))} aria-label="Previous month">
            <ChevronIcon size={20} className="flip" />
          </button>
          <b aria-live="polite">{label}</b>
          <button type="button" className="icon-btn" disabled={!canForward} onClick={() => setMonth(stepMonth(year, month, 1))} aria-label="Next month">
            <ChevronIcon size={20} />
          </button>
        </div>

        {years.length > 1 && (
          <div className="calendar-years" role="group" aria-label="Year">
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
          {WEEKDAYS.map((d, i) => (
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
                aria-label={`${parseISO(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${mark ? ', logged' : ''}${mark === 'great' ? ', a 75+ day' : ''}`}
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
            {logged ? `Logged on ${logged} day${logged === 1 ? '' : 's'} this month · ★ a 75+ day` : 'Nothing logged this month.'}
          </span>
          <button type="button" className="btn btn--sm btn--soft" onClick={() => pick(today)}>
            Today
          </button>
        </div>
      </div>
    </Sheet>
  );
}
