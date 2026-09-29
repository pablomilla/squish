import { useState } from 'react';
import type { MealEntry } from '../types';
import CookSheet, { useEatPlan } from './CookSheet';
import { useSquish } from '../store/useSquish';
import { useToast } from './ui';
import { CloseIcon, HeartFilledIcon } from './icons';
import './plan-card.css';
import { formatEnergy } from '../lib/region';
import { t } from '../lib/i18n';
import { slotName } from '../lib/words';

/**
 * A meal planned for later: dashed rather than solid, because it has not
 * happened, with the two things anybody does with a plan — say they ate it,
 * or let it go — and a tap on the meal for how to make it. Letting it go is
 * quiet on purpose: a plan not followed is not a failure, and nothing here
 * says it was.
 */
export default function PlanCard({ plan, showSlot = false }: { plan: MealEntry; showSlot?: boolean }) {
  const removePlan = useSquish((s) => s.removePlan);
  const eat = useEatPlan();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <div className="plan-card">
      {/* The meal itself opens as a recipe: what goes in it and how to make it. */}
      <button type="button" className="plan-card-body" onClick={() => setOpen(true)} aria-label={t('How to make {meal}', { meal: plan.title })}>
        <span className="plan-card-title" dir="auto">
          {plan.kept && <HeartFilledIcon size={13} className="plan-card-kept" />}
          {plan.title}
        </span>
        {/* Dashed, with "I ate this" beside it, says planned without the word — which left no room for the recipe. */}
        <span className="tiny muted plan-card-meta">
          {showSlot ? `${slotName(plan.slot)} · ` : ''}
          {formatEnergy(plan.nutrients.calories)} · {t('P{protein}', { protein: Math.round(plan.nutrients.protein) })}
          {' · '}
          <span className="plan-card-recipe">{t('Recipe')} ›</span>
        </span>
      </button>
      <button type="button" className="btn btn--sm btn--soft" onClick={() => eat(plan)}>
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
      <CookSheet plan={plan} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
