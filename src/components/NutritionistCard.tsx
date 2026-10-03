import { useMemo } from 'react';
import type { Route } from '../types';
import Squish from './Squish';
import { CalendarIcon, SparkIcon } from './icons';
import { useSquish } from '../store/useSquish';
import { useNutritionistAccess } from './useSubscribed';
import { suggestedQuestions } from '../lib/askSuggestions';
import { NUTRITIONIST_PLAN_NOTE } from '../lib/planner';
import { addDays, isoDate } from '../lib/date';
import './nutritionist-card.css';
import { useEssentials } from './useDetail';
import { t } from '../lib/i18n';

/**
 * The nutritionist, on Home, where it can be seen.
 *
 * It used to be one button among the logging ones, labelled with its own
 * name, which is the name of a thing nobody has tried. This is the card for
 * it: Squish thinking, a line on what it does, and two or three questions
 * about their own day that a tap asks — so the first thing anybody sees is
 * what they would get, not that they could ask. Its weekly meal plan is
 * here too, one tap away: planning the week is the other half of what the
 * nutritionist does.
 */
export default function NutritionistCard({ go }: { go: (route: Route) => void }) {
  const meals = useSquish((s) => s.meals);
  const targets = useSquish((s) => s.targets);
  const access = useNutritionistAccess();
  const plans = useSquish((s) => s.plans);
  const today = isoDate();
  // Whether the nutritionist has a plan on the go, so the button can open it rather than offer a new one.
  const planned = plans.some((p) => p.note === NUTRITIONIST_PLAN_NOTE && p.date >= today && p.date <= addDays(today, 7));
  const suggestion = useMemo(() => suggestedQuestions(meals, targets, today, new Date().getHours(), 1)[0], [meals, targets, today]);

  // Just the essentials: one line, the way in, and nothing to read first.
  const essentials = useEssentials();
  if (essentials)
    return (
      <section className="card nutri-card nutri-card--line" aria-label={t('Your nutritionist')}>
        <button type="button" className="nutri-ask" onClick={() => go({ name: 'ask' })}>
          <SparkIcon size={16} />
          <span>{t('Ask your nutritionist')}</span>
        </button>
      </section>
    );

  return (
    <section className="card nutri-card" aria-labelledby="nutri-title">
      <div className="nutri-head">
        <Squish mood="thinking" size={36} bob={false} label="" />
        <div className="nutri-head-text">
          <h3 id="nutri-title">{t('Your nutritionist')}</h3>
          {/* On Plus there is no count to show, and "unlimited" would only invite needless questions: what it does instead. */}
          <p className="tiny">{access.label ?? t('Reads your diary before it answers')}</p>
        </div>
        <button type="button" className="nutri-plan" onClick={() => go({ name: 'ask', tab: 'plan' })}>
          <CalendarIcon size={16} /> {planned ? t('My meal plan') : t('Plan my week')}
        </button>
      </div>
      {/* Today's suggested question, whole, in the box: tapped, it is typed in
          ready to send or change, never sent, so nothing is spent by accident. */}
      <button
        type="button"
        className="nutri-ask"
        onClick={() => go(suggestion ? { name: 'ask', draft: suggestion } : { name: 'ask' })}
      >
        <SparkIcon size={16} />
        <span>{suggestion ?? t('Ask anything…')}</span>
      </button>
    </section>
  );
}
