import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult, CookSteps, MealEntry } from '../types';
import Squish from './Squish';
import { Sheet, useToast } from './ui';
import { BookmarkIcon, HeartFilledIcon, HeartIcon, SwapIcon } from './icons';
import { CookMode, Ingredients, MethodSection, ServesStepper, useMethod } from './cookParts';
import { useSquish } from '../store/useSquish';
import { isPaywalled, swapPlannedMeal } from '../lib/api';
import { findRecipe, recipeFrom } from '../lib/recipes';
import { aboutOf } from '../lib/eating';
import { isSquishPlan, servingsFor } from '../lib/planner';
import { friendlyDate, isoDate } from '../lib/date';
import { formatEnergy } from '../lib/region';
import { plural, t } from '../lib/i18n';
import { slotName } from '../lib/words';
import './cook.css';

/** What anybody does with a plan once it is eaten: log it, and say so. */
export function useEatPlan(): (plan: MealEntry) => void {
  const eatPlan = useSquish((s) => s.eatPlan);
  const toast = useToast();
  return (plan) => {
    const ahead = plan.date > isoDate();
    const meal = eatPlan(plan.id);
    if (meal) toast(ahead ? t('Squished it — {energy} logged today.', { energy: formatEnergy(meal.nutrients.calories) }) : t('Squished it — {energy} logged.', { energy: formatEnergy(meal.nutrients.calories) }), '🎉');
  };
}

/**
 * A planned meal as a recipe: what goes in it, how to make it, and the way
 * to say it was made — with the two ways of changing a plan without planning
 * again: keep this one, or swap it for another.
 *
 * The ingredients are the plan's own, sized to the day, so they are there for
 * anybody at once. The steps are written the first time a Plus member opens
 * the meal — no tap to ask for them, since opening it was the asking — and
 * kept on the plan, so every time after it opens with them already there.
 */
export default function CookSheet({ plan, open, onClose }: { plan: MealEntry; open: boolean; onClose: () => void }) {
  const setPlanCook = useSquish((s) => s.setPlanCook);
  const toggleKeepPlan = useSquish((s) => s.toggleKeepPlan);
  const setPlanServings = useSquish((s) => s.setPlanServings);
  const saveRecipe = useSquish((s) => s.saveRecipe);
  const removeRecipe = useSquish((s) => s.removeRecipe);
  const recipes = useSquish((s) => s.recipes);
  const household = useSquish((s) => s.household);
  const servings = servingsFor(plan, household);
  const usual = servingsFor({ slot: plan.slot }, household);
  const eat = useEatPlan();
  const toast = useToast();
  const [cooking, setCooking] = useState(false);
  const [swapping, setSwapping] = useState(false);
  // Keeping means something only for the nutritionist's plans: a new week replaces those, and never theirs.
  const keepable = isSquishPlan(plan);
  const saved = findRecipe(recipes, plan.title);

  const keep = useCallback((steps: CookSteps) => setPlanCook(plan.id, steps), [plan.id, setPlanCook]);
  const current = useCallback(() => {
    const { plans, household: home } = useSquish.getState();
    const now = plans.find((p) => p.id === plan.id);
    return now && { title: now.title, servings: servingsFor(now, home) };
  }, [plan.id]);
  const method = useMethod({ id: plan.id, meal: plan, servings, stored: plan.cook, open, paused: swapping, keep, current });
  const { steps } = method;

  const save = () => saveRecipe(recipeFrom(plan, isoDate()));

  return (
    <Sheet open={open} onClose={onClose} title={plan.title}>
      <div className="cook">
        <p className="tiny muted cook-meta">
          {slotName(plan.slot)} · {friendlyDate(plan.date)} · {formatEnergy(plan.nutrients.calories)} · {t('P{protein}', { protein: Math.round(plan.nutrients.protein) })}
          {steps && ` · ${t('about {minutes} min', { minutes: steps.minutes })}`}
        </p>

        {!swapping && (
          <div className="cook-change">
            {keepable && (
              <button
                type="button"
                className={`chip cook-keep${plan.kept ? ' chip--on' : ''}`}
                aria-pressed={Boolean(plan.kept)}
                onClick={() => {
                  toggleKeepPlan(plan.id);
                  // Keeping is liking it: it goes in the recipe box too, and stays there if it is let go.
                  if (!plan.kept) save();
                  toast(plan.kept ? t('Not kept — a new week can replace it.') : t('Kept, and saved to your recipes — a new week plans around it, and more like it.'), plan.kept ? '🗓️' : '💜');
                }}
              >
                {plan.kept ? <HeartFilledIcon size={16} /> : <HeartIcon size={16} />} {plan.kept ? t('Kept') : t('Keep')}
              </button>
            )}
            <button type="button" className="chip" onClick={() => setSwapping(true)}>
              <SwapIcon size={16} /> {t('Swap')}
            </button>
            <button
              type="button"
              className={`chip${saved ? ' chip--on' : ''}`}
              aria-pressed={Boolean(saved)}
              onClick={() => {
                if (saved) {
                  removeRecipe(saved.id);
                  toast(t('Taken out of your recipes.'), '📕');
                } else {
                  save();
                  toast(t('Saved to your recipes.'), '📖');
                }
              }}
            >
              <BookmarkIcon size={16} filled={Boolean(saved)} /> {saved ? t('Saved') : t('Save')}
            </button>
          </div>
        )}

        {swapping ? (
          <SwapPanel plan={plan} onDone={() => setSwapping(false)} />
        ) : (
          <>
            <section>
              <div className="row-between">
                <h3 className="cook-head">{t('Ingredients')}</h3>
                <ServesStepper servings={servings} onChange={(n) => setPlanServings(plan.id, n === usual ? undefined : n)} />
              </div>
              <Ingredients items={plan.items} servings={servings} />
              <p className="tiny muted">
                {servings === 1
                  ? t('For one, sized to your day. These amounts are what gets logged.')
                  : plural(servings, {
                      one: 'For {n}. Your portion is one of them — {energy} — and that is what gets logged.',
                      other: 'For {n}. Your portion is one of them — {energy} — and that is what gets logged.',
                    }, { energy: formatEnergy(plan.nutrients.calories) })}
              </p>
            </section>

            <MethodSection method={method} />

            <div className="cook-actions">
              {steps && (
                <button type="button" className="btn btn--block" onClick={() => setCooking(true)}>
                  {t('Start cooking')}
                </button>
              )}
              <button type="button" className={steps ? 'btn btn--ghost btn--block' : 'btn btn--block'} onClick={() => eat(plan)}>
                {t('I made this')}
              </button>
            </div>
          </>
        )}
      </div>

      {cooking && steps && (
        <CookMode plan={plan} steps={steps.steps} detail={steps.detail} labels={steps.labels} items={plan.items} servings={servings} onClose={() => setCooking(false)} onDone={() => eat(plan)} />
      )}
    </Sheet>
  );
}

type Swap = { stage: 'finding' } | { stage: 'offer'; meal: AnalysisResult } | { stage: 'failed'; message: string };

/**
 * Another meal for the same place in the plan, sized to this one so the day
 * adds up as before — shown first, and only put in the plan if they say so.
 * "Try another" never offers the same one twice.
 */
function SwapPanel({ plan, onDone }: { plan: MealEntry; onDone: () => void }) {
  const { profile, plans, nutritionistNotes, replacePlan, notForMe } = useSquish();
  const toast = useToast();
  const [swap, setSwap] = useState<Swap>({ stage: 'finding' });
  const offered = useRef<string[]>([]);

  const find = useCallback(async () => {
    setSwap({ stage: 'finding' });
    const others = plans.filter((p) => p.id !== plan.id);
    try {
      const meal = await swapPlannedMeal({
        date: plan.date,
        slot: plan.slot,
        title: plan.title,
        calories: Math.round(plan.nutrients.calories),
        protein: Math.round(plan.nutrients.protein),
        dayMeals: others.filter((p) => p.date === plan.date).map((p) => p.title),
        // What it offered already, what else is planned, and what they have said is not for them.
        avoid: [...new Set([...offered.current, ...notForMe, ...others.map((p) => p.title)])].slice(0, 40),
        goal: profile.goal,
        sex: profile.sex,
        notes: nutritionistNotes.map((n) => n.note),
        about: aboutOf(profile),
      });
      offered.current = [...offered.current, meal.title];
      setSwap({ stage: 'offer', meal });
    } catch (error) {
      if (isPaywalled(error)) onDone();
      else setSwap({ stage: 'failed', message: error instanceof Error && error.message ? error.message : t('Squish could not swap that just now. Try again in a moment.') });
    }
  }, [plan, plans, profile, nutritionistNotes, notForMe, onDone]);

  // Opening the panel is asking for one.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void find();
  }, [find]);

  if (swap.stage === 'finding') {
    return (
      <div className="cook-writing" role="status" aria-live="polite">
        <Squish mood="thinking" size={72} bob={false} />
        <p className="small muted">{t('Finding another {meal}…', { meal: slotName(plan.slot).toLocaleLowerCase() })}</p>
        <button type="button" className="btn--quiet small" onClick={onDone}>
          {t('Cancel')}
        </button>
      </div>
    );
  }

  if (swap.stage === 'failed') {
    return (
      <div className="cook-ask">
        <p className="small cook-failed">{swap.message}</p>
        <button type="button" className="btn btn--soft btn--block" onClick={() => void find()}>
          {t('Try again')}
        </button>
        <button type="button" className="btn--quiet small" onClick={onDone}>
          {t('Keep {meal}', { meal: plan.title })}
        </button>
      </div>
    );
  }

  const { meal } = swap;
  return (
    <section className="cook-swap">
      <p className="small muted">{t('Instead of {meal}:', { meal: plan.title })}</p>
      <div className="cook-offer">
        <h3 dir="auto">{meal.title}</h3>
        <p className="tiny muted">
          {formatEnergy(meal.nutrients.calories)} · {t('P{protein}', { protein: Math.round(meal.nutrients.protein) })}
        </p>
        <Ingredients items={meal.items} />
      </div>
      <p className="tiny muted">{t('Sized to the meal it replaces, so your day still adds up.')}</p>
      <div className="cook-actions">
        <button
          type="button"
          className="btn btn--block"
          onClick={() => {
            replacePlan(plan.id, meal);
            toast(t('Swapped in {meal}.', { meal: meal.title }), '🔁');
            onDone();
          }}
        >
          {t('Use this')}
        </button>
        <button type="button" className="btn btn--ghost btn--block" onClick={() => void find()}>
          {t('Try another')}
        </button>
        <button type="button" className="btn--quiet small" onClick={onDone}>
          {t('Keep {meal}', { meal: plan.title })}
        </button>
      </div>
    </section>
  );
}
