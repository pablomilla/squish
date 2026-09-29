import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CookSteps, MealEntry } from '../types';
import Squish from './Squish';
import { CloseIcon } from './icons';
import { useSubscribed } from './useSubscribed';
import { cookSteps, isPaywalled } from '../lib/api';
import { describePortion } from '../lib/units';
import { MAX_SERVINGS } from '../lib/planner';
import { PLUS } from '../lib/plan';
import { t } from '../lib/i18n';

/*
 * The pieces a meal is cooked from, shared by a planned meal's recipe
 * (CookSheet) and the recipe box (RecipeBoxSheet): its ingredients, its
 * method — written when first opened, for however many it serves — and
 * cooking it one step at a time.
 */

export interface Method {
  /** Steps for this meal and this many people, or none yet. */
  steps?: CookSteps;
  asking: boolean;
  failed: string | null;
  /** The server said this is Plus's, whatever the app thought: offer, don't wait. */
  refused: boolean;
  subscribed: boolean;
  ask: () => Promise<void>;
}

/**
 * A meal's method: the steps kept for it if they are for this many people,
 * else written — on opening, for Plus, since opening it was the asking; and
 * again, after a moment's pause, when the number it serves changes.
 */
export function useMethod({
  id,
  meal,
  servings,
  stored,
  open,
  paused = false,
  keep,
  current,
}: {
  /** What it is, for knowing when it has changed: a plan's id, a recipe's. */
  id: string;
  meal: Pick<MealEntry, 'title' | 'slot' | 'items'>;
  servings: number;
  stored?: CookSteps;
  open: boolean;
  /** Not now: something else (a swap) is using the sheet. */
  paused?: boolean;
  keep: (steps: CookSteps) => void;
  /** The meal as it is now, to check the steps that come back are still its own. */
  current: () => { title: string; servings: number } | undefined;
}): Method {
  const subscribed = useSubscribed();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  // Steps written for another number of people are not these steps: their amounts are wrong.
  const steps = stored && (stored.servings ?? 1) === servings ? stored : undefined;

  const ask = useCallback(async () => {
    setAsking(true);
    setFailed(null);
    try {
      const written = await cookSteps(meal, servings);
      // Swapped, or cooking for a different number, while the steps were being written: these go nowhere.
      const now = current();
      if (now?.title === meal.title && now.servings === servings) keep(written);
    } catch (error) {
      // The paywall has already said what there is to say.
      if (isPaywalled(error)) setRefused(true);
      else setFailed(error instanceof Error && error.message ? error.message : t('The steps could not be written just now. Try again in a moment.'));
    } finally {
      setAsking(false);
    }
  }, [meal, servings, keep, current]);

  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    const which = `${id}:${meal.title}:${servings}`;
    if (!open || steps || !subscribed || paused || askedFor.current === which) return;
    // A moment's pause, so stepping from 2 to 5 people asks once, for 5.
    const timer = setTimeout(() => {
      askedFor.current = which;
      void ask();
    }, askedFor.current ? 600 : 0);
    return () => clearTimeout(timer);
  }, [open, steps, subscribed, paused, id, meal.title, servings, ask]);

  return { steps, asking, failed, refused, subscribed, ask };
}

/** The method section: the steps, or that they are being written, or the way to ask. */
export function MethodSection({ method }: { method: Method }) {
  const { steps, asking, failed, refused, subscribed, ask } = method;
  return (
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
  );
}

/** How many a meal is cooked for, from one to eight. */
export function ServesStepper({ servings, onChange }: { servings: number; onChange: (servings: number) => void }) {
  return (
    <div className="stepper cook-serves" aria-label={t('How many it serves')}>
      <button type="button" aria-label={t('Fewer people')} disabled={servings <= 1} onClick={() => onChange(servings - 1)}>
        −
      </button>
      <span aria-live="polite">{servings === 1 ? t('Serves 1') : t('Serves {n}', { n: servings })}</span>
      <button type="button" aria-label={t('More people')} disabled={servings >= MAX_SERVINGS} onClick={() => onChange(servings + 1)}>
        +
      </button>
    </div>
  );
}

/** A meal's ingredients, times however many it is cooked for. */
export function Ingredients({ items, servings = 1 }: { items: MealEntry['items']; servings?: number }) {
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

/**
 * One step at a time, big enough to read from across a kitchen, with the
 * screen kept awake where the browser allows — nobody should have to unlock a
 * phone with floury hands.
 */
export function CookMode({ plan, steps, onClose, onDone }: { plan: Pick<MealEntry, 'title'>; steps: string[]; onClose: () => void; onDone: () => void }) {
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
