import { useMemo, useState } from 'react';
import Squish from './Squish';
import PlanCard from './PlanCard';
import ShoppingSheet from './ShoppingSheet';
import WeekPlanSheet from './WeekPlanSheet';
import { BasketIcon, SparkIcon } from './icons';
import { useSquish } from '../store/useSquish';
import { useSubscribed } from './useSubscribed';
import { addDays, friendlyDate, isoDate } from '../lib/date';
import { NUTRITIONIST_PLAN_NOTE, PLAN_DAYS_AHEAD, plansOn } from '../lib/planner';
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
 */
export default function MealPlanPanel() {
  const plans = useSquish((s) => s.plans);
  const subscribed = useSubscribed();
  const [planning, setPlanning] = useState(false);
  const [shopping, setShopping] = useState(false);
  const today = isoDate();

  const days = useMemo(() => {
    const theirs = plans.filter((p) => p.note === NUTRITIONIST_PLAN_NOTE);
    return Array.from({ length: PLAN_DAYS_AHEAD + 1 }, (_, i) => addDays(today, i))
      .map((date) => ({ date, meals: plansOn(theirs, date) }))
      .filter((d) => d.meals.length > 0);
  }, [plans, today]);
  const count = days.reduce((sum, d) => sum + d.meals.length, 0);

  return (
    <div className="meal-plan">
      <WeekPlanSheet open={planning} onClose={() => setPlanning(false)} />
      <ShoppingSheet open={shopping} onClose={() => setShopping(false)} />

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
        </div>
      ) : (
        <>
          <div className="meal-plan-head">
            <p className="small">
              <b>{plural(count, { one: '{n} meal planned', other: '{n} meals planned' })}</b>{' '}
              <span className="muted">{t('· tap “I ate this” when you do')}</span>
            </p>
            <button type="button" className="btn--quiet small row" onClick={() => setShopping(true)}>
              <BasketIcon size={15} /> {t('Shopping list')}
            </button>
          </div>
          {days.map((day) => (
            <section key={day.date} className="meal-plan-day">
              <h3 className="small">{friendlyDate(day.date)}</h3>
              <div className="stack">
                {day.meals.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} showSlot />
                ))}
              </div>
            </section>
          ))}
          <button type="button" className="btn btn--soft btn--block" onClick={() => setPlanning(true)}>
            <SparkIcon size={16} /> {t('Plan a new week')}
          </button>
          <p className="tiny muted center">{t('These are in your diary too, dashed until you eat them.')}</p>
        </>
      )}
    </div>
  );
}
