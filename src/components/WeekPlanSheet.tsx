import { useEffect, useState } from 'react';
import type { MealSlot } from '../types';
import Squish from './Squish';
import HouseholdPicker from './HouseholdPicker';
import { Segmented, Sheet, useToast } from './ui';
import { useSquish } from '../store/useSquish';
import { useStanding, useSubscribed } from './useSubscribed';
import { addDays, friendlyDate, isoDate } from '../lib/date';
import { NUTRITIONIST_PLAN_NOTE, likesFrom, replacedOn, standingOn, weekDates } from '../lib/planner';
import { historyFor } from '../lib/planLearning';
import { PLUS } from '../lib/plan';
import {
  clearReadyWeekPlan,
  isPaywalled,
  latestWeekPlan,
  pendingWeekPlan,
  readyWeekPlan,
  requestWeekPlan,
  SquishApiError,
  waitForWeekPlan,
  waitingWeekPlan,
  type WeekPlan,
} from '../lib/api';
import './week-plan.css';
import { energyValue, formatEnergy } from '../lib/region';
import { plural, t } from '../lib/i18n';
import { slotName, slotWord } from '../lib/words';
import { aboutOf } from '../lib/eating';

type Stage = { kind: 'ask' } | { kind: 'planning' } | { kind: 'preview'; plan: WeekPlan };

const MEALS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];
const DAY_ORDER: MealSlot[] = [...MEALS, 'snack'];

/**
 * The nutritionist plans the days ahead, for Plus.
 *
 * Three steps: say what to plan (how many days, which meals, how much time
 * for cooking, anything else in their own words), wait while it thinks, then
 * look it over and choose what to keep. Kept meals become ordinary plans —
 * dashed in the diary, on the shopping list, counting for nothing until
 * eaten — so a plan somebody ignores costs them nothing at all.
 */
export default function WeekPlanSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, targets, meals, favourites, nutritionistNotes, addPlan, removePlans, plans, household, recipes, planLog, notForMe } = useSquish();
  const subscribed = useSubscribed();
  const planCounts = useStanding().weekplans;
  /** Weekly plans left this week, where the server has said (Plus only). */
  const plansLeft = subscribed && planCounts ? Math.max(0, planCounts.allowance - planCounts.used) : null;
  const toast = useToast();
  const today = isoDate();

  const [stage, setStage] = useState<Stage>({ kind: 'ask' });
  const [days, setDays] = useState<'3' | '5' | '7'>('7');
  const [start, setStart] = useState<'today' | 'tomorrow'>('tomorrow');
  const [slots, setSlots] = useState<MealSlot[]>(['breakfast', 'lunch', 'dinner']);
  const [snacks, setSnacks] = useState(false);
  const [cooking, setCooking] = useState<'quick' | 'normal' | 'batch'>('normal');
  const [preferences, setPreferences] = useState('');
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [discarding, setDiscarding] = useState(false);

  // Closing never throws a plan away: one that arrived is kept (lib/api.ts) and shown next time.
  const close = () => onClose();

  /**
   * A plan asked for and not seen yet — before this sheet (or the app) was
   * last closed, remembered here; or, when this browser has forgotten it,
   * one the server is keeping — wait for it again rather than ask anew.
   */
  useEffect(() => {
    if (!open || stage.kind !== 'ask') return;
    // One that arrived while nobody was looking — or was closed unkept — comes first.
    const ready = readyWeekPlan();
    if (ready) {
      setLeft(new Set());
      setStage({ kind: 'preview', plan: ready });
      return;
    }
    let cancelled = false;
    void (async () => {
      const job = pendingWeekPlan() ?? (await waitingWeekPlan());
      if (cancelled) return;
      if (!job) {
        // Nothing on the way: perhaps one was made and never arrived. Not if its meals are in the plans already.
        const inPlans = (week: WeekPlan) =>
          week.days.some((day) => day.meals.some((meal) => plans.some((p) => p.date === day.date && p.title === meal.title)));
        const lost = await latestWeekPlan(inPlans);
        if (lost && !cancelled) {
          setLeft(new Set());
          setStage({ kind: 'preview', plan: lost });
        }
        return;
      }
      setStage({ kind: 'planning' });
      try {
        const week = await waitForWeekPlan(job);
        setLeft(new Set());
        setStage({ kind: 'preview', plan: week });
      } catch (error) {
        setStage({ kind: 'ask' });
        toast(error instanceof Error ? error.message : t('That did not work — try again.'), '😕');
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per opening: the stage it moves to is not a reason to look again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const plan = async () => {
    setStage({ kind: 'planning' });
    try {
      const startDate = start === 'today' ? today : addDays(today, 1);
      const history = historyFor(planLog, notForMe, today);
      const kept = standingOn(plans, weekDates(startDate, Number(days)));
      const week = await requestWeekPlan({
        startDate,
        days: Number(days),
        slots,
        snacks,
        calorieTarget: targets.calories,
        proteinTarget: targets.protein,
        fibreTarget: targets.fibre,
        goal: profile.goal,
        sex: profile.sex,
        likes: likesFrom(meals, favourites, today, 15, plans, recipes),
        notes: nutritionistNotes.map((n) => n.note),
        preferences: preferences.trim(),
        cooking,
        about: aboutOf(profile),
        ...(kept.length ? { kept } : {}),
        ...(household.people > 1 ? { household } : {}),
        ...(history ? { history } : {}),
      });
      setLeft(new Set());
      setStage({ kind: 'preview', plan: week });
    } catch (error) {
      setStage({ kind: 'ask' });
      if (!isPaywalled(error)) toast(error instanceof SquishApiError || error instanceof Error ? error.message : t('That did not work — try again.'), '😕');
      else onClose();
    }
  };

  const keyOf = (date: string, index: number) => `${date}#${index}`;
  /** What adding the plan in preview would take the place of. */
  const replaced = stage.kind === 'preview' ? replacedOn(plans, stage.plan.days.map((d) => d.date)) : [];

  const keep = (week: WeekPlan) => {
    // What it plans on these days replaces what the nutritionist planned there
    // before — apart from the meals they kept and any they planned themselves.
    const dates = week.days.map((d) => d.date);
    removePlans(replacedOn(plans, dates).map((p) => p.id));
    const standing = new Set(standingOn(plans, dates).map((k) => `${k.date}#${k.slot}`));
    let added = 0;
    for (const day of week.days) {
      day.meals.forEach((meal, index) => {
        if (left.has(keyOf(day.date, index))) return;
        // Told to leave these slots alone, and checked on the server; this is for a plan made before they were kept.
        if (standing.has(`${day.date}#${meal.slot ?? 'dinner'}`)) return;
        addPlan({
          date: day.date,
          slot: meal.slot ?? 'dinner',
          title: meal.title,
          items: meal.items,
          nutrients: meal.nutrients,
          score: meal.score,
          source: 'describe',
          note: NUTRITIONIST_PLAN_NOTE,
        });
        added += 1;
      });
    }
    clearReadyWeekPlan();
    toast(plural(added, { one: '{n} meal added to your plans — and to your shopping list.', other: '{n} meals added to your plans — and to your shopping list.' }), '🗓️');
    setStage({ kind: 'ask' });
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={t('Plan my week')}>
      {stage.kind === 'ask' && (
        <div className="week-ask">
          <p className="small muted">
            {t('The nutritionist plans meals around your targets, the foods you already eat, and anything you have told it — an allergy, a food you avoid. You choose what to keep.')}
          </p>
          {!subscribed && <p className="badge badge--plus week-plus">{t('Part of {plus}', { plus: PLUS })}</p>}
          <Learned />

          <div className="field">
            <label>{t('How many days')}</label>
            <Segmented<'3' | '5' | '7'>
              label={t('How many days')}
              value={days}
              onChange={setDays}
              options={[
                { value: '3', label: plural(3, { one: '{n} day', other: '{n} days' }) },
                { value: '5', label: plural(5, { one: '{n} day', other: '{n} days' }) },
                { value: '7', label: t('A week') },
              ]}
            />
          </div>
          <div className="field">
            <label>{t('Starting')}</label>
            <Segmented<'today' | 'tomorrow'>
              label={t('Starting')}
              value={start}
              onChange={setStart}
              options={[
                { value: 'today', label: t('Today') },
                { value: 'tomorrow', label: t('Tomorrow') },
              ]}
            />
          </div>
          <div className="field">
            <label>{t('Which meals')}</label>
            <div className="week-chips">
              {MEALS.map((slot) => {
                const on = slots.includes(slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    className={`chip${on ? ' chip--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setSlots((list) => (on ? list.filter((s) => s !== slot) : [...list, slot]))}
                  >
                    {slotName(slot)}
                  </button>
                );
              })}
              <button type="button" className={`chip${snacks ? ' chip--on' : ''}`} aria-pressed={snacks} onClick={() => setSnacks((s) => !s)}>
                {t('A snack')}
              </button>
            </div>
          </div>
          <div className="field">
            <HouseholdPicker />
          </div>
          <div className="field">
            <label>{t('Cooking style')}</label>
            <Segmented<'quick' | 'normal' | 'batch'>
              label={t('Cooking style')}
              value={cooking}
              onChange={setCooking}
              options={[
                { value: 'quick', label: t('Quick') },
                { value: 'normal', label: t('Mixed') },
                { value: 'batch', label: t('Batch cook') },
              ]}
            />
          </div>
          <div className="field">
            <label htmlFor="week-prefs">{t('Anything else (optional)')}</label>
            <textarea
              id="week-prefs"
              className="textarea"
              rows={2}
              maxLength={300}
              value={preferences}
              placeholder={t('Vegetarian, no mushrooms, fish twice a week…')}
              onChange={(e) => setPreferences(e.target.value)}
            />
          </div>
          <button type="button" className="btn btn--block" disabled={!slots.length || plansLeft === 0} onClick={() => void plan()}>
            {days === '7' ? t('Plan my week') : t('Plan my {n} days', { n: Number(days) })}
          </button>
          <p className="tiny muted center">
            {plansLeft === 0
              ? t("That is this week's weekly plans. They come back on Monday.")
              : plansLeft !== null && plural(plansLeft, { one: '{n} weekly plan left this week.', other: '{n} weekly plans left this week.' })}
          </p>
        </div>
      )}

      {stage.kind === 'planning' && (
        <div className="week-planning" role="status" aria-live="polite">
          <Squish mood="thinking" size={110} />
          <p className="small">{t('Planning your meals…')}</p>
          <p className="tiny muted">{t('A week takes a minute or two to think through. You can close this — the plan will be here when you come back.')}</p>
        </div>
      )}

      {stage.kind === 'preview' && (
        <div className="week-preview">
          {stage.plan.summary && <p className="small week-summary" dir="auto">{stage.plan.summary}</p>}
          {replaced.length > 0 && (
            <p className="tiny muted week-replaces">
              {plural(replaced.length, {
                one: 'This replaces the {n} meal the nutritionist planned for these days before. Meals you kept, and ones you planned yourself, stay.',
                other: 'This replaces the {n} meals the nutritionist planned for these days before. Meals you kept, and ones you planned yourself, stay.',
              })}
            </p>
          )}
          {stage.plan.days.map((day) => {
            const standing = standingOn(plans, [day.date]);
            const standingKcal = standing.reduce((sum, k) => sum + k.calories, 0);
            return (
            <section key={day.date} className="week-day">
              <div className="week-day-head">
                <h4 className="small">{friendlyDate(day.date)}</h4>
                <span className="tiny muted">
                  {t('{eaten} of {target}', { eaten: energyValue(day.calories + standingKcal), target: formatEnergy(targets.calories) })}
                </span>
              </div>
              {day.underFloor && <p className="tiny week-light">{t('This day came out light — add a snack if you keep it.')}</p>}
              <ul>
                {/* The new meals and the ones already standing, in the order the day is eaten. */}
                {[
                  ...standing.map((k) => ({ slot: k.slot, kept: k, meal: null, index: -1 })),
                  ...day.meals.map((meal, index) => ({ slot: meal.slot ?? 'dinner', kept: null, meal, index })),
                ]
                  .sort((x, y) => DAY_ORDER.indexOf(x.slot) - DAY_ORDER.indexOf(y.slot))
                  .map(({ kept: k, meal, index }) => {
                    if (k) {
                      return (
                        <li key={`kept-${k.slot}`}>
                          <div className="week-meal is-kept">
                            <span className="week-kept-mark" aria-hidden="true">♥</span>
                            <span className="week-meal-text" dir="auto">
                              <span className="week-meal-title">{k.title}</span>
                              <span className="tiny muted">
                                {slotWord(k.slot)} · {formatEnergy(k.calories)} · {t('already in your plans')}
                              </span>
                            </span>
                          </div>
                        </li>
                      );
                    }
                    const key = keyOf(day.date, index);
                    const kept = !left.has(key);
                    return (
                      <li key={key}>
                        <label className={`week-meal${kept ? '' : ' is-left'}`}>
                          <input
                            type="checkbox"
                            checked={kept}
                            onChange={() =>
                              setLeft((set) => {
                                const next = new Set(set);
                                if (kept) next.add(key);
                                else next.delete(key);
                                return next;
                              })
                            }
                          />
                          <span className="week-meal-text" dir="auto">
                            <span className="week-meal-title">{meal!.title}</span>
                            <span className="tiny muted">
                              {slotWord(meal!.slot ?? 'dinner')} · {formatEnergy(meal!.nutrients.calories)} · {t('P{protein}', { protein: Math.round(meal!.nutrients.protein) })} ·{' '}
                              {meal!.items.map((item) => item.name).join(', ')}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
              </ul>
            </section>
            );
          })}
          {discarding ? (
            // Asked here, in Squish's own words, not in a browser box headed with the web address.
            <div className="week-discard" role="alertdialog" aria-labelledby="week-discard-q">
              <p className="small" id="week-discard-q">
                {t('Throw this plan away? It still counts as one of this week’s plans.')}
              </p>
              <div className="row" style={{ gap: 10 }}>
                <button type="button" className="btn btn--sm btn--ghost grow" onClick={() => setDiscarding(false)}>
                  {t('Keep it')}
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--danger grow"
                  onClick={() => {
                    clearReadyWeekPlan();
                    setDiscarding(false);
                    setStage({ kind: 'ask' });
                  }}
                >
                  {t('Throw it away')}
                </button>
              </div>
            </div>
          ) : (
            <div className="week-actions">
              <button type="button" className="btn btn--block" onClick={() => keep(stage.plan)}>
                {t('Add to my plans')}
              </button>
              {/* The one way a plan is thrown away, so it asks first: it was one of the month's. */}
              <button type="button" className="btn--quiet small" onClick={() => setDiscarding(true)}>
                {t('Start again')}
              </button>
            </div>
          )}
          <p className="tiny muted center">{t('Plans count for nothing until you tap “I ate this”. Untick anything you don’t fancy.')}</p>
        </div>
      )}
    </Sheet>
  );
}

/**
 * What the next plan will learn from, said before it is asked for: the
 * learning is theirs to see, and to change on the meal plan's check-in.
 */
function Learned() {
  const planLog = useSquish((s) => s.planLog);
  const notForMe = useSquish((s) => s.notForMe);
  const history = historyFor(planLog, notForMe, isoDate());
  if (!history || (!history.hits.length && !history.misses.length && !history.never.length)) return null;
  const few = (titles: string[]) => titles.slice(0, 2).join(', ');
  const parts = [
    history.hits.length ? t('more like {meals}', { meals: few(history.hits) }) : '',
    history.misses.length ? t('fewer like {meals}', { meals: few(history.misses) }) : '',
    history.never.length ? t('never what you said is not for you') : '',
  ].filter(Boolean);
  return (
    <p className="tiny week-learned">
      <span aria-hidden="true">🧠</span> {t('Learning from your last plans: {what}.', { what: parts.join('; ') })}
      {history.planned > 0 && history.made < history.planned / 2 && ` ${t('It will keep this one simpler, with more leftovers.')}`}
    </p>
  );
}
