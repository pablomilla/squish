import { useMemo, useState } from 'react';
import type { Route } from '../types';
import { useSquish } from '../store/useSquish';
import { addDays, isoDate, slotForNow } from '../lib/date';
import { asAnalysis, ideasFor, plansOn, remainingToday } from '../lib/planner';
import PlanCard from './PlanCard';
import ShoppingSheet from './ShoppingSheet';
import WeekPlanSheet from './WeekPlanSheet';
import { useSubscribed } from './useSubscribed';
import { PLUS } from '../lib/plan';
import { BasketIcon, SparkIcon } from './icons';
import './plan-card.css';

/** After this hour the day is for winding down, not for being handed dinner ideas. */
const IDEAS_UNTIL_HOUR = 21;

/**
 * Home's two planning cards: what was planned for today, each a tap from
 * being logged, and a few ideas from their own food for what is left.
 *
 * An idea opens in the review screen like any other meal, where it can be
 * logged as eaten or planned for later — so there is one way to save a meal,
 * not two that drift apart.
 */
export default function TodayPlanning({ go }: { go: (route: Route) => void }) {
  const plans = useSquish((s) => s.plans);
  const meals = useSquish((s) => s.meals);
  const favourites = useSquish((s) => s.favourites);
  const targets = useSquish((s) => s.targets);
  const today = isoDate();
  const [shopping, setShopping] = useState(false);
  const [weekPlanning, setWeekPlanning] = useState(false);
  const subscribed = useSubscribed();
  // The offer to plan the week shows only to somebody using the diary, and only while nothing is planned.
  const planningAhead = plans.some((p) => p.date >= today && p.date <= addDays(today, 7));
  const offerWeek = !planningAhead && meals.length >= 3;

  const planned = useMemo(() => plansOn(plans, today), [plans, today]);
  const ateToday = meals.some((m) => m.date === today);
  const ideas = useMemo(
    () => (ateToday && new Date().getHours() < IDEAS_UNTIL_HOUR ? ideasFor(meals, favourites, targets, today) : []),
    [ateToday, meals, favourites, targets, today],
  );
  const left = useMemo(() => remainingToday(meals, targets, today), [meals, targets, today]);

  return (
    <>
      <ShoppingSheet open={shopping} onClose={() => setShopping(false)} />
      <WeekPlanSheet open={weekPlanning} onClose={() => setWeekPlanning(false)} />
      {offerWeek && (
        <section className="card card--quiet home-week-offer">
          <div className="card-title">
            <h3>Plan the week ahead</h3>
            {!subscribed && <span className="badge">{PLUS}</span>}
          </div>
          <p className="tiny muted">
            The nutritionist can plan meals around your targets and the food you like, with a shopping list to match. You choose what to keep.
          </p>
          <button type="button" className="btn btn--soft btn--sm" onClick={() => setWeekPlanning(true)}>
            <SparkIcon size={15} /> Plan my week
          </button>
        </section>
      )}
      {planned.length > 0 && (
        <section className="card home-planned">
          <div className="card-title">
            <h3>Planned for today</h3>
            <button type="button" className="btn--quiet small row" onClick={() => setShopping(true)}>
              <BasketIcon size={15} /> Shopping list
            </button>
          </div>
          <div className="stack">
            {planned.map((plan) => (
              <PlanCard key={plan.id} plan={plan} showSlot />
            ))}
          </div>
        </section>
      )}

      {ideas.length > 0 && (
        <section className="card card--quiet home-ideas">
          <div className="card-title">
            <h3>Ideas for the rest of today</h3>
          </div>
          <p className="tiny muted">
            About {left.calories.toLocaleString('en-GB')} kcal{left.protein >= 10 ? ` and ${left.protein} g of protein` : ''} left. A few of
            your own that fit:
          </p>
          <div className="stack">
            {ideas.map((idea) => (
              <button
                key={idea.key}
                type="button"
                className="idea"
                onClick={() => go({ name: 'review', draft: { analysis: asAnalysis(idea, slotForNow()), slot: slotForNow(), date: today } })}
              >
                <span className="idea-body">
                  <span className="idea-title">{idea.title}</span>
                  <span className="tiny muted">
                    {Math.round(idea.nutrients.calories)} kcal · P{Math.round(idea.nutrients.protein)} · {idea.from === 'saved' ? 'saved' : 'you’ve had it before'}
                  </span>
                </span>
                <span className="badge">{idea.why}</span>
              </button>
            ))}
          </div>
          <p className="tiny muted home-ideas-foot">Tap one to log it now or plan it for later.</p>
        </section>
      )}
    </>
  );
}
