import type { MealEntry } from '../types';
import { useSquish } from '../store/useSquish';
import { useToast } from './ui';
import { CloseIcon } from './icons';
import { isoDate } from '../lib/date';
import './plan-card.css';

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
        <span className="plan-card-title">{plan.title}</span>
        <span className="tiny muted">
          Planned{showSlot ? ` · ${plan.slot}` : ''} · {Math.round(plan.nutrients.calories)} kcal · P{Math.round(plan.nutrients.protein)}
        </span>
      </span>
      <button
        type="button"
        className="btn btn--sm btn--soft"
        onClick={() => {
          const meal = eatPlan(plan.id);
          if (meal) toast(`Squished it — ${Math.round(meal.nutrients.calories)} kcal logged${ahead ? ' today' : ''}.`, '🎉');
        }}
      >
        I ate this
      </button>
      <button
        type="button"
        className="icon-btn plan-card-drop"
        aria-label={`Remove the plan for ${plan.title}`}
        onClick={() => {
          removePlan(plan.id);
          toast('Plan removed', '🗓️');
        }}
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
