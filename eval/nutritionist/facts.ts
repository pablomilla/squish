/**
 * What is true about the diary, worked out rather than written down.
 *
 * Every expected answer in this eval comes from here, so nothing is asserted
 * in two places. Change the fixture and the gold moves with it — which is the
 * only defence against the commonest rot in an eval, a correct answer that
 * quietly became the wrong one.
 */
import type { MealEntry, MicroKey, Targets } from '../../src/types';
import { addDays, lastDays, parseISO } from '../../src/lib/date';
import { dayScore, mealsOn, series, summarise, totalsOn } from '../../src/lib/selectors';
import { computeTargets, microTargets } from '../../src/lib/nutrition';
import { saltGrams } from '../../src/lib/units';
import { DEFAULT_PROFILE } from '../../src/store/useSquish';
import { FISH_DAYS, FIRST_DAY, TODAY, buildDiary } from './diary';

/*
 * Chosen so the diary sits roughly on target rather than miles over it. A
 * fixture where every single day breaks the calorie target answers half the
 * questions before they are asked — "how was my week" becomes "over", always,
 * and the eval stops telling variants apart.
 */
export const PROFILE = {
  ...DEFAULT_PROFILE,
  name: 'Mia', sex: 'female' as const, age: 29,
  heightCm: 168, weightKg: 70, targetWeightKg: 66,
  activity: 'moderate' as const, goal: 'lose' as const, pace: 0.25,
  onboarded: true,
};
export const TARGETS: Targets = computeTargets(PROFILE);
export const MEALS: MealEntry[] = buildDiary();

const isWeekend = (iso: string) => [0, 6].includes(parseISO(iso).getDay());
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round = (x: number, dp = 1) => Math.round(x * 10 ** dp) / 10 ** dp;

const allDays = (() => {
  const out: string[] = [];
  for (let d = FIRST_DAY; d <= TODAY; d = addDays(d, 1)) out.push(d);
  return out;
})();
const loggedDays = allDays.filter((d) => mealsOn(MEALS, d).length > 0);

/** Averaged over the days that carried a figure — the same rule the tool uses. */
function microAverage(key: MicroKey, days: string[]) {
  const values = days.map((d) => totalsOn(MEALS, d).micros?.[key]).filter((v): v is number => v !== undefined);
  return { mean: values.length ? round(mean(values), 1) : null, days: values.length, of: days.length };
}

const kcalOn = (d: string) => totalsOn(MEALS, d).calories;

export const FACTS = {
  today: TODAY,
  firstDay: FIRST_DAY,
  daysLogged: loggedDays.length,
  daysTotal: allDays.length,
  unloggedDays: allDays.filter((d) => !loggedDays.includes(d)),

  targets: {
    calories: TARGETS.calories,
    protein: TARGETS.protein,
    fibre: TARGETS.fibre,
    iron: microTargets(PROFILE).iron ?? 0,
    /*
     * In grams of salt, which is the only form the app ever says out loud.
     * Nutrition is stored as sodium in milligrams; every packet in a British
     * shop states salt. A claim written against the 6 g national guideline
     * instead of this number asks for something the app never puts in front
     * of the model, and cannot be satisfied by reading the diary correctly.
     */
    salt: saltGrams(TARGETS.sodium ?? 0),
  },

  /** Weekends against weekdays, across the whole six weeks. */
  weekend: {
    kcal: Math.round(mean(loggedDays.filter(isWeekend).map(kcalOn))),
    weekdayKcal: Math.round(mean(loggedDays.filter((d) => !isWeekend(d)).map(kcalOn))),
    get gap() { return this.kcal - this.weekdayKcal; },
  },

  /** Protein, first logged week against the last — the trend a question asks about. */
  protein: {
    firstWeek: Math.round(mean(loggedDays.slice(0, 7).map((d) => totalsOn(MEALS, d).protein))),
    lastWeek: Math.round(mean(lastDays(7, TODAY).filter((d) => loggedDays.includes(d)).map((d) => totalsOn(MEALS, d).protein))),
    target: TARGETS.protein,
  },

  /** The last seven days, which is what most questions mean by "this week". */
  week: summarise(series(MEALS, lastDays(7, TODAY), TARGETS), TARGETS),

  /** Oily fish: when, and how long ago. */
  fish: {
    days: FISH_DAYS,
    last: FISH_DAYS[FISH_DAYS.length - 1],
    daysSince: allDays.length - 1 - allDays.indexOf(FISH_DAYS[FISH_DAYS.length - 1]),
  },

  /** Vitamins and minerals over the last six weeks, and how much food they cover. */
  micros: {
    iron: microAverage('iron', loggedDays),
    calcium: microAverage('calcium', loggedDays),
    vitaminD: microAverage('vitaminD', loggedDays),
    vitaminC: microAverage('vitaminC', loggedDays),
    /** Never reported by anything. An average of these does not exist. */
    vitaminB12: microAverage('vitaminB12', loggedDays),
    folate: microAverage('folate', loggedDays),
    mealsWithAny: MEALS.filter((m) => m.nutrients.micros && Object.keys(m.nutrients.micros).length).length,
    mealsTotal: MEALS.length,
  },

  /** The worst day in the six weeks, and what made it worst. */
  blowout: (() => {
    const worst = loggedDays
      .map((date) => ({ date, totals: totalsOn(MEALS, date), score: dayScore(MEALS, date, TARGETS) }))
      .sort((a, b) => (b.totals.satFat ?? 0) - (a.totals.satFat ?? 0))[0];
    return {
      date: worst.date,
      kcal: Math.round(worst.totals.calories),
      satFat: Math.round(worst.totals.satFat ?? 0),
      salt: saltGrams(worst.totals.sodium ?? 0),
      score: worst.score,
    };
  })(),

  /** Where the diary simply does not know, because nothing recorded it. */
  unknown: {
    satFatFrom: loggedDays.find((d) => totalsOn(MEALS, d).satFat !== undefined) ?? '',
    daysWithoutSatFat: loggedDays.filter((d) => totalsOn(MEALS, d).satFat === undefined).length,
  },
} as const;
