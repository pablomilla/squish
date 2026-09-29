import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AnalysisResult, MealEntry } from '../types';
import Squish from './Squish';
import { Sheet, useToast } from './ui';
import { CloseIcon, HeartFilledIcon, HeartIcon, SwapIcon } from './icons';
import { useSquish } from '../store/useSquish';
import { useSubscribed } from './useSubscribed';
import { cookSteps, isPaywalled, swapPlannedMeal } from '../lib/api';
import { aboutOf } from '../lib/eating';
import { MAX_SERVINGS, NUTRITIONIST_PLAN_NOTE, servingsFor } from '../lib/planner';
import { friendlyDate, isoDate } from '../lib/date';
import { describePortion } from '../lib/units';
import { formatEnergy } from '../lib/region';
import { PLUS } from '../lib/plan';
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
  const household = useSquish((s) => s.household);
  const servings = servingsFor(plan, household);
  const usual = servingsFor({ slot: plan.slot }, household);
  const subscribed = useSubscribed();
  const eat = useEatPlan();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** The server said this is Plus's, whatever the app thought: offer, don't wait. */
  const [refused, setRefused] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [swapping, setSwapping] = useState(false);
  // Steps written for another number of people are not these steps: their amounts are wrong.
  const steps = plan.cook && (plan.cook.servings ?? 1) === servings ? plan.cook : undefined;
  // Keeping means something only for the nutritionist's plans: a new week replaces those, and never theirs.
  const keepable = plan.note === NUTRITIONIST_PLAN_NOTE;

  const ask = useCallback(async () => {
    setAsking(true);
    setFailed(null);
    try {
      const written = await cookSteps(plan, servings);
      // Swapped, or cooking for a different number, while the steps were being written: these go nowhere.
      const { plans: now, household: home } = useSquish.getState();
      const current = now.find((p) => p.id === plan.id);
      if (current?.title === plan.title && servingsFor(current, home) === servings) setPlanCook(plan.id, written);
    } catch (error) {
      // The paywall has already said what there is to say.
      if (isPaywalled(error)) setRefused(true);
      else setFailed(error instanceof Error && error.message ? error.message : t('The steps could not be written just now. Try again in a moment.'));
    } finally {
      setAsking(false);
    }
  }, [plan, servings, setPlanCook]);

  // Opening a Plus member's meal is asking for its steps: once per meal, not on
  // every render — and again for the meal it was swapped for.
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    const meal = `${plan.id}:${plan.title}:${servings}`;
    if (!open || steps || !subscribed || swapping || askedFor.current === meal) return;
    // A moment's pause, so stepping from 2 to 5 people asks once, for 5.
    const timer = setTimeout(() => {
      askedFor.current = meal;
      void ask();
    }, askedFor.current ? 600 : 0);
    return () => clearTimeout(timer);
  }, [open, steps, subscribed, swapping, plan.id, plan.title, servings, ask]);

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
                  toast(plan.kept ? t('Not kept — a new week can replace it.') : t('Kept — a new week plans around it, and more like it.'), plan.kept ? '🗓️' : '💜');
                }}
              >
                {plan.kept ? <HeartFilledIcon size={16} /> : <HeartIcon size={16} />} {plan.kept ? t('Kept') : t('Keep')}
              </button>
            )}
            <button type="button" className="chip" onClick={() => setSwapping(true)}>
              <SwapIcon size={16} /> {t('Swap')}
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
                <div className="stepper cook-serves" aria-label={t('How many it serves')}>
                  <button type="button" aria-label={t('Fewer people')} disabled={servings <= 1} onClick={() => setPlanServings(plan.id, servings - 1 === usual ? undefined : servings - 1)}>
                    −
                  </button>
                  <span aria-live="polite">{servings === 1 ? t('Serves 1') : t('Serves {n}', { n: servings })}</span>
                  <button type="button" aria-label={t('More people')} disabled={servings >= MAX_SERVINGS} onClick={() => setPlanServings(plan.id, servings + 1 === usual ? undefined : servings + 1)}>
                    +
                  </button>
                </div>
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

            <section>
              <h3 className="cook-head">{t('Method')}</h3>
              {steps ? (
                <>
                  <ol className="cook-steps">
                    {steps.steps.map((step, i) => (
                      <li key={i} dir="auto">{step}</li>
                    ))}
                  </ol>
                  {steps.tip && (
                    <p className="cook-tip small" dir="auto">
                      <span aria-hidden="true">💡</span> {steps.tip}
                    </p>
                  )}
                </>
              ) : asking || (subscribed && !failed && !refused) ? (
                // Also while a change in how many it serves settles, so the old steps are not replaced by a button for a moment.
                <div className="cook-writing">
                  <Squish mood="thinking" size={64} bob={false} />
                  <p className="small muted">{t('Writing the steps for you…')}</p>
                </div>
              ) : (
                <div className="cook-ask">
                  {failed && <p className="small cook-failed">{failed}</p>}
                  <button type="button" className="btn btn--soft btn--block" onClick={() => void ask()}>
                    {failed ? t('Try again') : t('Show me how to make it')}
                  </button>
                  {!subscribed && <p className="tiny muted center">{t('Part of {plus}.', { plus: PLUS })}</p>}
                </div>
              )}
            </section>

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

      {cooking && steps && <CookMode plan={plan} steps={steps.steps} onClose={() => setCooking(false)} onDone={() => eat(plan)} />}
    </Sheet>
  );
}

/** A meal's ingredients, times however many it is cooked for. */
function Ingredients({ items, servings = 1 }: { items: MealEntry['items']; servings?: number }) {
  return (
    <ul className="cook-ingredients">
      {items.map((item, i) => (
        <li key={item.id ?? i}>
          <span aria-hidden="true">{item.emoji ?? '🍽️'}</span>
          <span className="grow" dir="auto">{item.name}</span>
          <span className="small muted">
            {servings === 1
              ? describePortion(item.portion, item.grams, item.liquid)
              : describePortion(`${servings} × ${item.portion}`, item.grams ? item.grams * servings : undefined, item.liquid)}
          </span>
        </li>
      ))}
    </ul>
  );
}

type Swap = { stage: 'finding' } | { stage: 'offer'; meal: AnalysisResult } | { stage: 'failed'; message: string };

/**
 * Another meal for the same place in the plan, sized to this one so the day
 * adds up as before — shown first, and only put in the plan if they say so.
 * "Try another" never offers the same one twice.
 */
function SwapPanel({ plan, onDone }: { plan: MealEntry; onDone: () => void }) {
  const { profile, plans, nutritionistNotes, replacePlan } = useSquish();
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
        avoid: [...new Set([...offered.current, ...others.map((p) => p.title)])].slice(0, 40),
        goal: profile.goal,
        sex: profile.sex,
        notes: nutritionistNotes.map((n) => n.note),
        about: aboutOf(profile),
      });
      offered.current = [...offered.current, meal.title];
      setSwap({ stage: 'offer', meal });
    } catch (error) {
      if (isPaywalled(error)) onDone();
      else setSwap({ stage: 'failed', message: error instanceof Error && error.message ? error.message : t('The nutritionist could not swap that just now. Try again in a moment.') });
    }
  }, [plan, plans, profile, nutritionistNotes, onDone]);

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

/**
 * One step at a time, big enough to read from across a kitchen, with the
 * screen kept awake where the browser allows — nobody should have to unlock a
 * phone with floury hands.
 */
function CookMode({ plan, steps, onClose, onDone }: { plan: MealEntry; steps: string[]; onClose: () => void; onDone: () => void }) {
  const [at, setAt] = useState(0);
  const [awake, setAwake] = useState(false);
  const last = at === steps.length - 1;

  // Keep the screen on, and take it back when the page comes back into view:
  // the browser lets go of the lock whenever the tab is hidden.
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return;
    let lock: { release: () => Promise<void> } | null = null;
    let live = true;
    const take = () => {
      nav.wakeLock!.request('screen').then(
        (got) => {
          if (!live) void got.release().catch(() => {});
          else {
            lock = got;
            setAwake(true);
          }
        },
        () => setAwake(false),
      );
    };
    const onVisible = () => document.visibilityState === 'visible' && take();
    take();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

  // Arrows to move, Escape to leave cooking — and only cooking: caught before
  // the sheet underneath hears it and closes as well.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight') setAt((n) => Math.min(steps.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setAt((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [steps.length, onClose]);

  return createPortal(
    <div className="cook-mode" role="dialog" aria-modal="true" aria-label={t('Cooking {meal}', { meal: plan.title })}>
      <div className="cook-mode-top">
        <span className="small muted cook-mode-count">{t('Step {n} of {total}', { n: at + 1, total: steps.length })}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Stop cooking')}>
          <CloseIcon />
        </button>
      </div>
      <div className="cook-mode-progress" aria-hidden="true">
        {steps.map((_, i) => (
          <span key={i} className={i <= at ? 'is-done' : ''} />
        ))}
      </div>
      <p className="tiny muted cook-mode-title" dir="auto">{plan.title}</p>

      <p className="cook-mode-step" dir="auto" aria-live="polite">
        {steps[at]}
      </p>

      <div className="cook-mode-foot">
        {awake && <p className="tiny muted center">{t('Your screen stays on while you cook.')}</p>}
        <div className="cook-mode-nav">
          <button type="button" className="btn btn--ghost" disabled={at === 0} onClick={() => setAt(at - 1)}>
            {t('Back')}
          </button>
          {last ? (
            <button type="button" className="btn grow" onClick={onDone}>
              {t('Done — I made this')}
            </button>
          ) : (
            <button type="button" className="btn grow" onClick={() => setAt(at + 1)}>
              {t('Next step')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
