import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MealEntry } from '../types';
import Squish from './Squish';
import { Sheet, useToast } from './ui';
import { CloseIcon } from './icons';
import { useSquish } from '../store/useSquish';
import { useSubscribed } from './useSubscribed';
import { cookSteps, isPaywalled } from '../lib/api';
import { friendlyDate, isoDate } from '../lib/date';
import { describePortion } from '../lib/units';
import { formatEnergy } from '../lib/region';
import { PLUS } from '../lib/plan';
import { t } from '../lib/i18n';
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
 * to say it was made.
 *
 * The ingredients are the plan's own, sized to the day, so they are there for
 * anybody at once. The steps are written the first time a Plus member opens
 * the meal — no tap to ask for them, since opening it was the asking — and
 * kept on the plan, so every time after it opens with them already there.
 */
export default function CookSheet({ plan, open, onClose }: { plan: MealEntry; open: boolean; onClose: () => void }) {
  const setPlanCook = useSquish((s) => s.setPlanCook);
  const subscribed = useSubscribed();
  const eat = useEatPlan();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [cooking, setCooking] = useState(false);
  const steps = plan.cook;

  const ask = useCallback(async () => {
    setAsking(true);
    setFailed(null);
    try {
      setPlanCook(plan.id, await cookSteps(plan));
    } catch (error) {
      // The paywall has already said what there is to say.
      if (!isPaywalled(error)) setFailed(error instanceof Error && error.message ? error.message : t('The steps could not be written just now. Try again in a moment.'));
    } finally {
      setAsking(false);
    }
  }, [plan, setPlanCook]);

  // Opening a Plus member's meal is asking for its steps; once, not on every render.
  const asked = useRef(false);
  useEffect(() => {
    if (!open || steps || !subscribed || asked.current) return;
    asked.current = true;
    void ask();
  }, [open, steps, subscribed, ask]);

  return (
    <Sheet open={open} onClose={onClose} title={plan.title}>
      <div className="cook">
        <p className="tiny muted cook-meta">
          {slotName(plan.slot)} · {friendlyDate(plan.date)} · {formatEnergy(plan.nutrients.calories)} · {t('P{protein}', { protein: Math.round(plan.nutrients.protein) })}
          {steps && ` · ${t('about {minutes} min', { minutes: steps.minutes })}`}
        </p>

        <section>
          <h3 className="cook-head">{t('Ingredients')}</h3>
          <ul className="cook-ingredients">
            {plan.items.map((item) => (
              <li key={item.id}>
                <span aria-hidden="true">{item.emoji ?? '🍽️'}</span>
                <span className="grow" dir="auto">{item.name}</span>
                <span className="small muted">{describePortion(item.portion, item.grams, item.liquid)}</span>
              </li>
            ))}
          </ul>
          <p className="tiny muted">{t('For one, sized to your day. These amounts are what gets logged.')}</p>
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
          ) : asking ? (
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
      </div>

      {cooking && steps && <CookMode plan={plan} steps={steps.steps} onClose={() => setCooking(false)} onDone={() => eat(plan)} />}
    </Sheet>
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
