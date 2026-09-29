import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CookSteps, FoodItem, MealEntry } from '../types';
import StepArt from './StepArt';
import { STEP_LABELS, detailsFor, usedIn, type StepDetail } from '../lib/cooking';
import Squish from './Squish';
import { CloseIcon } from './icons';
import { useSubscribed } from './useSubscribed';
import { cookSteps, isPaywalled, relabelCookSteps } from '../lib/api';
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

  // Steps labelled the old way are labelled again, once, by the model: it reads any language.
  const relabelled = useRef<CookSteps | null>(null);
  useEffect(() => {
    if (!open || !steps || !subscribed || paused || (steps.labels ?? 0) >= STEP_LABELS || relabelled.current === steps) return;
    relabelled.current = steps;
    void relabelCookSteps(steps.steps, meal.items).then((detail) => {
      const now = current();
      if (detail && now?.title === meal.title && now.servings === servings) keep({ ...steps, detail, labels: STEP_LABELS });
    });
  }, [open, steps, subscribed, paused, meal, servings, keep, current]);

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
 * phone with floury hands. Each step has a picture of what it does, the foods
 * it uses (for however many it serves), and a timer when it has something to
 * wait for: the timer keeps going between steps, and says so at the top.
 */
export function CookMode({
  plan,
  steps,
  detail,
  labels,
  items = [],
  servings = 1,
  onClose,
  onDone,
}: {
  plan: Pick<MealEntry, 'title'>;
  steps: string[];
  detail?: StepDetail[];
  /** Which way the detail was labelled: the model's own, now, is trusted as it is. */
  labels?: number;
  items?: FoodItem[];
  servings?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [at, setAt] = useState(0);
  const [awake, setAwake] = useState(false);
  const last = at === steps.length - 1;
  // The model labels steps by where the food is now, in any language; older labels get the rules in src/lib/cooking.ts.
  const details = detailsFor(steps, detail, (labels ?? 0) >= STEP_LABELS ? undefined : items);
  const step = details[at];
  const using = usedIn(steps[at], items);
  const timer = useStepTimer();

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

  const elsewhere = timer.state && timer.state.step !== at;

  return createPortal(
    <div className="cook-mode" role="dialog" aria-modal="true" aria-label={t('Cooking {meal}', { meal: plan.title })}>
      <div className="cook-mode-top">
        <span className="small muted cook-mode-count">{t('Step {n} of {total}', { n: at + 1, total: steps.length })}</span>
        {elsewhere && (
          <button type="button" className={`cook-timer-pill${timer.done ? ' is-done' : ''}`} onClick={() => setAt(timer.state!.step)}>
            ⏱ {timer.done ? t('Time’s up — step {n}', { n: timer.state!.step + 1 }) : `${clock(timer.left)} · ${t('step {n}', { n: timer.state!.step + 1 })}`}
          </button>
        )}
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

      <div className="cook-mode-body">
        <div className="cook-mode-art" key={at}>
          <StepArt action={step.action} />
        </div>

        <p className="cook-mode-step" dir="auto" aria-live="polite">
          {steps[at]}
        </p>

        {using.length > 0 && (
          <div className="cook-mode-uses">
            <span className="tiny muted">{t('For this step')}</span>
            <ul>
              {using.map((item, i) => (
                <li key={item.id ?? i} className="cook-use">
                  <span aria-hidden="true">{item.emoji ?? '🍽️'}</span> <span dir="auto">{item.name}</span>
                  {item.grams ? <span className="muted"> · {describePortion('', item.grams * servings, item.liquid)}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {step.minutes && (
          <StepTimer
            minutes={step.minutes}
            here={timer.state?.step === at ? timer : null}
            onStart={() => timer.start(at, step.minutes!)}
          />
        )}
      </div>

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

/** mm:ss, from milliseconds. */
function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface Timer {
  state: { step: number; total: number; ends: number | null; left: number } | null;
  left: number;
  done: boolean;
  start: (step: number, minutes: number) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

/**
 * One kitchen timer for the whole cook: started from a step, running while
 * the other steps are read, and when it ends it says so — a chime and a buzz
 * where the phone allows, and on screen whichever step is showing.
 */
function useStepTimer(): Timer {
  const [state, setState] = useState<Timer['state']>(null);
  const [now, setNow] = useState(() => Date.now());
  const rung = useRef(false);
  const sound = useRef<AudioContext | null>(null);
  const left = state ? (state.ends ? Math.max(0, state.ends - now) : state.left) : 0;
  const done = Boolean(state?.ends) && left === 0;

  useEffect(() => {
    if (!state?.ends) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [state]);

  useEffect(() => {
    if (!done || rung.current) return;
    rung.current = true;
    navigator.vibrate?.([250, 120, 250, 120, 250]);
    chime(sound.current);
  }, [done]);

  return {
    state,
    left,
    done,
    start: (step, minutes) => {
      // Made on the tap that starts it: a browser only lets a page make a sound it was asked for.
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        sound.current ??= Ctx ? new Ctx() : null;
        void sound.current?.resume();
      } catch {
        sound.current = null;
      }
      rung.current = false;
      const total = minutes * 60_000;
      setNow(Date.now());
      setState({ step, total, ends: Date.now() + total, left: total });
    },
    pause: () => state?.ends && setState({ ...state, ends: null, left: Math.max(0, state.ends - Date.now()) }),
    resume: () => state && !state.ends && setState({ ...state, ends: Date.now() + state.left }),
    stop: () => setState(null),
  };
}

/** Three soft notes. Nothing at all where the browser will not play them. */
function chime(ctx: AudioContext | null): void {
  if (!ctx) return;
  try {
    [0, 0.35, 0.7].forEach((at, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = [660, 880, 990][i];
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.32);
    });
  } catch {
    /* a timer that cannot chime still shows it is done */
  }
}

/** The step's timer: a button to start it, then the countdown with pause and stop. */
function StepTimer({ minutes, here, onStart }: { minutes: number; here: Timer | null; onStart: () => void }) {
  if (!here?.state) {
    return (
      <button type="button" className="btn btn--soft cook-timer-start" onClick={onStart}>
        ⏱ {t('Start a {n}-minute timer', { n: minutes })}
      </button>
    );
  }
  const share = here.state.total ? here.left / here.state.total : 0;
  return (
    <div className={`cook-timer${here.done ? ' is-done' : ''}`} role="timer" aria-live={here.done ? 'assertive' : 'off'}>
      <div className="cook-timer-ring" style={{ ['--left' as string]: `${Math.round(share * 360)}deg` }}>
        <span className="cook-timer-arc" aria-hidden="true" />
        <b>{here.done ? t('Time’s up') : clock(here.left)}</b>
      </div>
      <div className="cook-timer-actions">
        {here.done ? (
          <button type="button" className="btn btn--sm btn--soft" onClick={here.stop}>
            {t('Done')}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--sm btn--ghost" onClick={here.state.ends ? here.pause : here.resume}>
              {here.state.ends ? t('Pause') : t('Carry on')}
            </button>
            <button type="button" className="btn--quiet small" onClick={here.stop}>
              {t('Stop')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
