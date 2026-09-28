import { useMemo, useState } from 'react';
import { Sheet } from './ui';
import type { Route } from '../types';
import { useSquish } from '../store/useSquish';
import { isoDate, slotForNow } from '../lib/date';
import { asAnalysis, ideasFor, remainingToday } from '../lib/planner';
import './plan-card.css';
import { formatEnergy } from '../lib/region';
import { t } from '../lib/i18n';

/** After this hour the day is for winding down, not for being handed dinner ideas. */
const IDEAS_UNTIL_HOUR = 21;

/**
 * Home's ideas for the rest of today, from their own food: a chip on the
 * row of today's meals, opening them in a sheet, so Home stays one screen.
 *
 * An idea opens in the review screen like any other meal, where it can be
 * logged as eaten or planned for later — so there is one way to save a meal,
 * not two that drift apart.
 */
export default function TodayPlanning({ go }: { go: (route: Route) => void }) {
  const meals = useSquish((s) => s.meals);
  const favourites = useSquish((s) => s.favourites);
  const targets = useSquish((s) => s.targets);
  const today = isoDate();

  const ateToday = meals.some((m) => m.date === today);
  const ideas = useMemo(
    () => (ateToday && new Date().getHours() < IDEAS_UNTIL_HOUR ? ideasFor(meals, favourites, targets, today) : []),
    [ateToday, meals, favourites, targets, today],
  );
  const left = useMemo(() => remainingToday(meals, targets, today), [meals, targets, today]);

  const [open, setOpen] = useState(false);
  if (ideas.length === 0) return null;

  return (
    <>
      <button type="button" className="chip home-ideas-chip" onClick={() => setOpen(true)}>
        <span aria-hidden="true">💡</span> {t('{n} ideas', { n: ideas.length })}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('Ideas for the rest of today')}>
        <p className="tiny muted">
          {left.protein >= 10
            ? t('About {energy} and {grams} g of protein left. A few of your own that fit:', { energy: formatEnergy(left.calories), grams: left.protein })
            : t('About {energy} left. A few of your own that fit:', { energy: formatEnergy(left.calories) })}
        </p>
        <div className="stack" style={{ marginTop: 10 }}>
          {ideas.map((idea) => (
            <button
              key={idea.key}
              type="button"
              className="idea"
              onClick={() => go({ name: 'review', draft: { analysis: asAnalysis(idea, slotForNow()), slot: slotForNow(), date: today } })}
            >
              <span className="idea-body">
                <span className="idea-title" dir="auto">{idea.title}</span>
                <span className="tiny muted">
                  {formatEnergy(idea.nutrients.calories)} · {t('P{protein}', { protein: Math.round(idea.nutrients.protein) })} ·{' '}
                  {idea.from === 'saved' ? t('saved') : t('you’ve had it before')}
                </span>
              </span>
              <span className="badge">{idea.why}</span>
            </button>
          ))}
        </div>
        <p className="tiny muted home-ideas-foot">{t('Tap one to log it now or plan it for later.')}</p>
      </Sheet>
    </>
  );
}
