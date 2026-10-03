import { useEffect, useMemo, useState } from 'react';
import type { MealEntry } from '../types';
import Squish from './Squish';
import PlanCard from './PlanCard';
import ShoppingSheet from './ShoppingSheet';
import WeekPlanSheet from './WeekPlanSheet';
import RecipeBoxSheet from './RecipeBoxSheet';
import PlanReviewCard from './PlanReviewCard';
import { BasketIcon, BookmarkIcon, CheckIcon, PenIcon, SparkIcon, TrashIcon } from './icons';
import { Sheet } from './ui';
import { useSquish } from '../store/useSquish';
import { useSubscribed } from './useSubscribed';
import { addDays, friendlyDate, isoDate } from '../lib/date';
import { PLAN_DAYS_AHEAD, currentPlan, plansOn } from '../lib/planner';
import { slotName } from '../lib/words';
import { formatEnergy } from '../lib/region';
import { PLUS } from '../lib/plan';
import './meal-plan-panel.css';
import { plural, t } from '../lib/i18n';

/**
 * The nutritionist's meal plan, where the nutritionist lives.
 *
 * The week it planned, day by day, from today: each meal a tap from logged,
 * the shopping list for all of it, and the way to plan the next week. The
 * plans themselves are ordinary ones (the diary shows them too); this is the
 * nutritionist's own view of the ones it made.
 *
 * And the way to change it all at once rather than meal by meal: clear the
 * whole plan, clear a day, or pick the meals to let go — each with an Undo,
 * because a week of meals is a lot to lose to a slip of the thumb.
 */

/** How long Undo stays offered after a clear. */
const UNDO_MS = 10_000;

interface Undo {
  plans: MealEntry[];
  /** Picked one by one, so noted as dropped: Undo takes that back too. */
  judged: boolean;
}
export default function MealPlanPanel() {
  const plans = useSquish((s) => s.plans);
  const dropPlans = useSquish((s) => s.dropPlans);
  const restorePlans = useSquish((s) => s.restorePlans);
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [clearing, setClearing] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const subscribed = useSubscribed();
  const [planning, setPlanning] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [box, setBox] = useState(false);
  const saved = useSquish((s) => s.recipes.length);
  const today = isoDate();

  const theirs = useMemo(() => currentPlan(plans, today), [plans, today]);
  const kept = theirs.filter((p) => p.kept).length;
  const days = useMemo(() => {
    return Array.from({ length: PLAN_DAYS_AHEAD + 1 }, (_, i) => addDays(today, i))
      .map((date) => ({ date, meals: plansOn(theirs, date) }))
      .filter((d) => d.meals.length > 0);
  }, [theirs, today]);
  const count = days.reduce((sum, d) => sum + d.meals.length, 0);

  // Undo is offered for a while, then the clear stands.
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const drop = (ids: string[], judged: boolean) => {
    if (!ids.length) return;
    const gone = dropPlans(ids, judged);
    setUndo({ plans: gone, judged });
    setChosen(new Set());
    // Nothing left to edit: a new week starts out of edit mode.
    if (gone.length >= theirs.length) setEditing(false);
  };
  const finishEditing = () => {
    setEditing(false);
    setChosen(new Set());
  };
  const toggle = (id: string) =>
    setChosen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearPlan = (keepKept: boolean) => {
    drop(theirs.filter((p) => !(keepKept && p.kept)).map((p) => p.id), false);
    setClearing(false);
    finishEditing();
  };

  return (
    <div className="meal-plan">
      <WeekPlanSheet open={planning} onClose={() => setPlanning(false)} />
      <ShoppingSheet open={shopping} onClose={() => setShopping(false)} />
      <RecipeBoxSheet open={box} onClose={() => setBox(false)} />
      <PlanReviewCard />

      {undo && (
        <div className="meal-plan-undo" role="status">
          <span className="small">{plural(undo.plans.length, { one: '{n} meal removed from your plan', other: '{n} meals removed from your plan' })}</span>
          <button
            type="button"
            className="btn btn--sm btn--soft"
            onClick={() => {
              restorePlans(undo.plans, undo.judged);
              setUndo(null);
            }}
          >
            {t('Undo')}
          </button>
        </div>
      )}

      <Sheet open={clearing} onClose={() => setClearing(false)} title={t('Clear your meal plan?')}>
        <div className="stack meal-plan-clear">
          <p className="small">
            {plural(count, {
              one: 'This takes the {n} meal the nutritionist planned from today out of your plan and your diary, and its shopping off the list.',
              other: 'This takes the {n} meals the nutritionist planned from today out of your plan and your diary, and their shopping off the list.',
            })}
          </p>
          <p className="tiny muted">{t('Meals you have already eaten stay in your diary, and you can plan a new week whenever you like.')}</p>
          <button type="button" className="btn btn--danger btn--block" onClick={() => clearPlan(false)}>
            <TrashIcon size={16} /> {plural(count, { one: 'Clear the {n} meal', other: 'Clear all {n} meals' })}
          </button>
          {kept > 0 && kept < count && (
            <button type="button" className="btn btn--soft btn--block" onClick={() => clearPlan(true)}>
              {plural(kept, { one: 'Clear all but the {n} you kept', other: 'Clear all but the {n} you kept' })}
            </button>
          )}
          <button type="button" className="btn btn--quiet btn--block" onClick={() => setClearing(false)}>
            {t('Cancel')}
          </button>
        </div>
      </Sheet>

      {days.length === 0 ? (
        <div className="meal-plan-empty">
          <Squish mood="thinking" size={96} />
          <h2>{t('Let me plan your week')}</h2>
          <p className="small muted">
            {t('Meals around your targets, the food you already like, and anything you’ve told me — an allergy, a food you avoid. With a shopping list to match, and you choose what to keep.')}
          </p>
          <button type="button" className="btn btn--block" onClick={() => setPlanning(true)}>
            <SparkIcon size={16} /> {t('Plan my week')}
          </button>
          {!subscribed && <p className="tiny muted">{t('Part of {plus}.', { plus: PLUS })}</p>}
          {saved > 0 && (
            <button type="button" className="btn--quiet small row" onClick={() => setBox(true)}>
              <BookmarkIcon size={15} /> {t('My recipes ({n})', { n: saved })}
            </button>
          )}
        </div>
      ) : (
        <>
          {editing ? (
            <div className="meal-plan-head">
              <p className="small">
                <b>{t('Edit your plan')}</b> <span className="muted">{t('· pick meals to remove, or clear a day')}</span>
              </p>
              <button type="button" className="btn btn--sm btn--soft" onClick={finishEditing}>
                {t('Done')}
              </button>
            </div>
          ) : (
          <div className="meal-plan-head">
            <p className="small">
              <b>{plural(count, { one: '{n} meal planned', other: '{n} meals planned' })}</b>{' '}
              <span className="muted">{t('· tap “I ate this” when you do')}</span>
            </p>
            <span className="row meal-plan-links">
              <button type="button" className="btn--quiet small row" onClick={() => setEditing(true)}>
                <PenIcon size={15} /> {t('Edit plan')}
              </button>
              <button type="button" className="btn--quiet small row" onClick={() => setBox(true)}>
                <BookmarkIcon size={15} /> {t('My recipes')}
              </button>
              <button type="button" className="btn--quiet small row" onClick={() => setShopping(true)}>
                <BasketIcon size={15} /> {t('Shopping list')}
              </button>
            </span>
          </div>
          )}
          {days.map((day) => (
            <section key={day.date} className="meal-plan-day">
              <div className="meal-plan-day-head">
                <h3 className="small">{friendlyDate(day.date)}</h3>
                {editing && (
                  <button type="button" className="btn--quiet small" onClick={() => drop(day.meals.map((p) => p.id), false)}>
                    {t('Clear day')}
                  </button>
                )}
              </div>
              <div className="stack">
                {day.meals.map((plan) =>
                  editing ? (
                    <label key={plan.id} className={`meal-plan-pick${chosen.has(plan.id) ? ' meal-plan-pick--on' : ''}`}>
                      <input type="checkbox" className="meal-plan-pick-box" checked={chosen.has(plan.id)} onChange={() => toggle(plan.id)} />
                      <span className="meal-plan-tick" aria-hidden="true">
                        {chosen.has(plan.id) && <CheckIcon size={14} />}
                      </span>
                      <span className="meal-plan-pick-body">
                        <span className="meal-plan-pick-title" dir="auto">{plan.title}</span>
                        <span className="tiny muted">
                          {slotName(plan.slot)} · {formatEnergy(plan.nutrients.calories)}
                        </span>
                      </span>
                    </label>
                  ) : (
                    <PlanCard key={plan.id} plan={plan} showSlot />
                  ),
                )}
              </div>
            </section>
          ))}
          {editing ? (
            <div className="meal-plan-edit-bar">
              <button
                type="button"
                className="btn--quiet small"
                onClick={() => setChosen(chosen.size === count ? new Set() : new Set(theirs.map((p) => p.id)))}
              >
                {chosen.size === count ? t('Select none') : t('Select all')}
              </button>
              <button type="button" className="btn btn--danger" disabled={chosen.size === 0} onClick={() => drop([...chosen], true)}>
                <TrashIcon size={16} />{' '}
                {chosen.size === 0 ? t('Remove') : plural(chosen.size, { one: 'Remove {n} meal', other: 'Remove {n} meals' })}
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="btn btn--soft btn--block" onClick={() => setPlanning(true)}>
                <SparkIcon size={16} /> {t('Plan a new week')}
              </button>
              <button type="button" className="btn btn--quiet btn--block meal-plan-clear-all" onClick={() => setClearing(true)}>
                <TrashIcon size={16} /> {t('Clear the plan')}
              </button>
              <p className="tiny muted center">{t('These are in your diary too, dashed until you eat them.')}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
