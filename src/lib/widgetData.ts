/**
 * What the home-screen widgets show beside Quick snap: today at a glance.
 *
 * The widgets are native (ios/App/SquishWidgets, android/…/SnapWidgetProvider)
 * and cannot read the diary, so the app hands them this small summary
 * whenever it changes (src/lib/widgets.ts). Everything is worked out here, in
 * the person's units and language, so the widgets only draw it: the one sum
 * they do themselves is noticing that the summary is from an earlier day,
 * when nothing has been eaten yet today and the whole target is left.
 */
import type { MealEntry, QueuedSnap, Targets } from '../types';
import { addDays, isoDate } from './date';
import { energyValue, type EnergyUnit } from './region';
import { streakOf, totalsOn } from './selectors';
import { plural, t } from './i18n';

/** How far back a quick snap still asks to be checked, as on Home's card. */
const CHECK_DAYS = 7;

export interface WidgetSummary {
  /** Bumped when the shape changes, so an old widget can ignore a new one. */
  v: 1;
  /** The day the figures are for. A widget showing a later day starts it at nothing eaten. */
  date: string;
  /** Off in the app's settings: the widget shows Quick snap and nothing about the day. */
  hidden: boolean;
  /** In the person's own unit, whole numbers. */
  energy: { eaten: number; target: number; unit: EnergyUnit };
  /** Grams. */
  protein: { eaten: number; target: number };
  streak: number;
  /** Quick-snapped meals logged without anybody looking, still to check. */
  toCheck: number;
  /** Quick snaps still being read. */
  reading: number;
  /**
   * The widget's words, already in the person's language. `{n}` is a number
   * the widget writes in itself, so a summary from yesterday still reads
   * right today.
   */
  words: {
    quickSnap: string;
    left: string;
    over: string;
    ofTarget: string;
    protein: string;
    streak: string;
    toCheck: string;
    reading: string;
    openApp: string;
    /** What Quick snap is, for a widget with room and no numbers to show. */
    tagline: string;
  };
}

export function widgetSummary(state: {
  meals: MealEntry[];
  targets: Targets;
  snaps: QueuedSnap[];
  unit: EnergyUnit;
  hidden: boolean;
  today?: string;
}): WidgetSummary {
  const today = state.today ?? isoDate();
  const totals = totalsOn(state.meals, today);
  const since = addDays(today, -CHECK_DAYS);
  const streak = streakOf(state.meals, today);
  const toCheck = state.meals.filter((meal) => meal.quick && meal.date >= since).length;
  const reading = state.snaps.filter((snap) => snap.state === 'sent' || snap.state === 'waiting').length;
  const unit = state.unit;
  return {
    v: 1,
    date: today,
    hidden: state.hidden,
    energy: { eaten: energyValue(totals.calories, unit), target: energyValue(state.targets.calories, unit), unit },
    protein: { eaten: Math.round(totals.protein), target: Math.round(state.targets.protein) },
    streak,
    toCheck,
    reading,
    words: {
      quickSnap: t('Quick snap'),
      left: unit === 'kJ' ? t('{n} kJ left') : t('{n} kcal left'),
      over: unit === 'kJ' ? t('{n} kJ over') : t('{n} kcal over'),
      ofTarget: unit === 'kJ' ? t('{eaten} of {target} kJ') : t('{eaten} of {target} kcal'),
      protein: t('{eaten} of {target} g protein'),
      streak: plural(streak, { one: '{n}-day streak', other: '{n}-day streak' }),
      toCheck: plural(toCheck, { one: '{n} snap to check', other: '{n} snaps to check' }),
      reading: plural(reading, { one: 'Reading {n} snap…', other: 'Reading {n} snaps…' }),
      openApp: t('Open Squish'),
      tagline: t('Photograph a meal in one tap. Squish logs it for you to check later.'),
    },
  };
}
