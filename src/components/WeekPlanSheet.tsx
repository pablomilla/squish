import { useState } from 'react';
import type { MealSlot } from '../types';
import Squish from './Squish';
import { Segmented, Sheet, useToast } from './ui';
import { useSquish } from '../store/useSquish';
import { useSubscribed } from './useSubscribed';
import { addDays, friendlyDate, isoDate } from '../lib/date';
import { NUTRITIONIST_PLAN_NOTE, likesFrom } from '../lib/planner';
import { PLUS } from '../lib/plan';
import { isPaywalled, requestWeekPlan, SquishApiError, type WeekPlan } from '../lib/api';
import './week-plan.css';
import { energyValue, formatEnergy } from '../lib/region';
import { plural, t } from '../lib/i18n';
import { slotName, slotWord } from '../lib/words';

type Stage = { kind: 'ask' } | { kind: 'planning' } | { kind: 'preview'; plan: WeekPlan };

const MEALS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

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
  const { profile, targets, meals, favourites, nutritionistNotes, addPlan } = useSquish();
  const subscribed = useSubscribed();
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

  const close = () => {
    onClose();
    if (stage.kind !== 'planning') setStage({ kind: 'ask' });
  };

  const plan = async () => {
    setStage({ kind: 'planning' });
    try {
      const week = await requestWeekPlan({
        startDate: start === 'today' ? today : addDays(today, 1),
        days: Number(days),
        slots,
        snacks,
        calorieTarget: targets.calories,
        proteinTarget: targets.protein,
        fibreTarget: targets.fibre,
        goal: profile.goal,
        sex: profile.sex,
        likes: likesFrom(meals, favourites, today),
        notes: nutritionistNotes.map((n) => n.note),
        preferences: preferences.trim(),
        cooking,
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

  const keep = (week: WeekPlan) => {
    let added = 0;
    for (const day of week.days) {
      day.meals.forEach((meal, index) => {
        if (left.has(keyOf(day.date, index))) return;
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
            <label>{t('Cooking')}</label>
            <Segmented<'quick' | 'normal' | 'batch'>
              label={t('Cooking')}
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
          <button type="button" className="btn btn--block" disabled={!slots.length} onClick={() => void plan()}>
            {days === '7' ? t('Plan my week') : t('Plan my {n} days', { n: Number(days) })}
          </button>
          <p className="tiny muted center">{t("Uses one of this month's questions for the nutritionist.")}</p>
        </div>
      )}

      {stage.kind === 'planning' && (
        <div className="week-planning" role="status" aria-live="polite">
          <Squish mood="thinking" size={110} />
          <p className="small">{t('Planning your meals…')}</p>
          <p className="tiny muted">{t('A week takes a minute or so to think through.')}</p>
        </div>
      )}

      {stage.kind === 'preview' && (
        <div className="week-preview">
          {stage.plan.summary && <p className="small week-summary" dir="auto">{stage.plan.summary}</p>}
          {stage.plan.days.map((day) => (
            <section key={day.date} className="week-day">
              <div className="week-day-head">
                <h4 className="small">{friendlyDate(day.date)}</h4>
                <span className="tiny muted">
                  {t('{eaten} of {target}', { eaten: energyValue(day.calories), target: formatEnergy(targets.calories) })}
                </span>
              </div>
              {day.underFloor && <p className="tiny week-light">{t('This day came out light — add a snack if you keep it.')}</p>}
              <ul>
                {day.meals.map((meal, index) => {
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
                          <span className="week-meal-title">{meal.title}</span>
                          <span className="tiny muted">
                            {slotWord(meal.slot ?? 'dinner')} · {formatEnergy(meal.nutrients.calories)} · {t('P{protein}', { protein: Math.round(meal.nutrients.protein) })} ·{' '}
                            {meal.items.map((item) => item.name).join(', ')}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <div className="week-actions">
            <button type="button" className="btn btn--block" onClick={() => keep(stage.plan)}>
              {t('Add to my plans')}
            </button>
            <button type="button" className="btn--quiet small" onClick={() => setStage({ kind: 'ask' })}>
              {t('Start again')}
            </button>
          </div>
          <p className="tiny muted center">{t('Plans count for nothing until you tap “I ate this”. Untick anything you don’t fancy.')}</p>
        </div>
      )}
    </Sheet>
  );
}
