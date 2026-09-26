import type { MealEntry } from '../types';
import { useSquish } from '../store/useSquish';
import { useToast } from './ui';
import { CloseIcon } from './icons';
import { isoDate } from '../lib/date';
import './plan-card.css';
import { formatEnergy } from '../lib/region';
import { t } from '../lib/i18n';
import { slotWord } from '../lib/words';

/**
 * A meal planned for later: dashed rather than solid, because it has not
 * happened, with the two things anybody does with a plan — say they ate it,
 * or let it go. Letting it go is quiet on purpose: a plan not followed is
 * not a failure, and nothing here says it was.
 */
export default function PlanCard({ plan, showSlot = false }: { plan: MealEntry; showSlot?: boolean }) {
  const eatPlan = useSquish((s) => s.eatPlan);
  const removePlan = useSquish((s) => s.removePlan);
  const toast = useToast();
  const ahead = plan.date > isoDate();

  return (
    <div className="plan-card">
      <span className="plan-card-body">
        <span className="plan-card-title" dir="auto">{plan.title}</span>
        <span className="tiny muted">
          {t('Planned')}
          {showSlot ? ` · ${slotWord(plan.slot)}` : ''} · {formatEnergy(plan.nutrients.calories)} · {t('P{protein}', { protein: Math.round(plan.nutrients.protein) })}
        </span>
      </span>
      <button
        type="button"
        className="btn btn--sm btn--soft"
        onClick={() => {
          const meal = eatPlan(plan.id);
          if (meal) toast(ahead ? t('Squished it — {energy} logged today.', { energy: formatEnergy(meal.nutrients.calories) }) : t('Squished it — {energy} logged.', { energy: formatEnergy(meal.nutrients.calories) }), '🎉');
        }}
      >
        {t('I ate this')}
      </button>
      <button
        type="button"
        className="icon-btn plan-card-drop"
        aria-label={t('Remove the plan for {meal}', { meal: plan.title })}
        onClick={() => {
          removePlan(plan.id);
          toast(t('Plan removed'), '🗓️');
        }}
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
