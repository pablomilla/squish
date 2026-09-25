/**
 * The day score, explained: what it is about, whether it is too early to
 * mean much, and what moved it today.
 *
 * The score answers "how good was what I ate, for what it was made of" —
 * not how much. Each meal is scored on its make-up (lib/nutrition.ts,
 * `scoreBreakdown`), the day is those scores averaged by calories, and going
 * well over a daily limit costs a few points on top. The reasons below come
 * from the same breakdown the score is built from, weighted the same way, so
 * they cannot contradict it.
 */
import { overPenalty, overTargets, scoreBreakdown, ultraProcessedShare, CEILING_LABEL, type ScoreFactorKey } from './nutrition';
import { mealsOn, totalsOn, dayScore } from './selectors';
import type { MealEntry, Targets } from '../types';

/**
 * Below this, today is too early to judge: one 90 kcal snack at breakfast
 * time would otherwise decide the whole day's label. Past days are what they
 * were, so this only ever applies to today.
 */
export const EARLY_KCAL = 400;

const WORDS: Record<ScoreFactorKey, string> = {
  protein: 'Protein',
  fibre: 'Fibre',
  salt: 'Salt',
  sugar: 'Sugar',
  freeSugar: 'Added sugar',
  satFat: 'Saturated fat',
  fat: 'Fat',
  processed: 'Ultra-processed food',
};

export interface Reason {
  key: ScoreFactorKey | 'over';
  words: string;
  /** Points it moved the day by, rounded; positive lifted it. */
  points: number;
}

export interface DayExplained {
  score: number;
  early: boolean;
  calories: number;
  /** Biggest first, up to five, anything under a point left out. */
  reasons: Reason[];
  /** One kind suggestion for lifting it, or none when it is going well. */
  tip: string | null;
}

export function explainDay(meals: MealEntry[], date: string, targets: Targets, today: string): DayExplained {
  const list = mealsOn(meals, date).filter((m) => m.nutrients.calories > 0);
  const totals = totalsOn(meals, date);
  const score = dayScore(meals, date, targets);
  const early = date === today && totals.calories < EARLY_KCAL;

  // The same weighting dayScore uses: bigger meals count for more, and even
  // a biscuit counts for something.
  const weights = list.map((m) => Math.max(60, m.nutrients.calories));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const sums: Partial<Record<ScoreFactorKey, number>> = {};
  list.forEach((meal, i) => {
    const { factors } = scoreBreakdown(meal.nutrients, ultraProcessedShare(meal.items ?? []));
    for (const [key, points] of Object.entries(factors) as [ScoreFactorKey, number][]) {
      sums[key] = (sums[key] ?? 0) + (points * weights[i]) / total;
    }
  });

  const reasons: Reason[] = (Object.entries(sums) as [ScoreFactorKey, number][]).map(([key, points]) => ({
    key,
    words: WORDS[key],
    points: Math.round(points),
  }));
  const over = overTargets(totals, targets);
  const penalty = overPenalty(over);
  if (penalty > 0 && over[0]) reasons.push({ key: 'over', words: `Well over your ${CEILING_LABEL[over[0].key].toLowerCase()} for the day`, points: -penalty });

  const shown = reasons.filter((r) => Math.abs(r.points) >= 1).sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 5);

  // One suggestion, aimed at whatever brought the day down most — or, when
  // nothing much is lifting it, at what would.
  const lift = (sums.protein ?? 0) + (sums.fibre ?? 0);
  const worst = shown.filter((r) => r.points < 0)[0]?.key;
  let tip: string | null = null;
  if (list.length && score < 55) {
    tip =
      lift < 15
        ? 'Something with protein or fibre — eggs, beans, yoghurt, veg or wholegrains — lifts the score most.'
        : worst === 'freeSugar' || worst === 'sugar'
          ? 'Fancy something sweet? Fruit, yoghurt or a few nuts score far higher than sweets and bars.'
          : worst === 'processed'
            ? 'Simple, home-cooked food lifts the score more than packaged food does.'
            : worst === 'satFat' || worst === 'fat'
              ? 'Veg, beans, fish or lean meat alongside richer food balance the day out.'
              : worst === 'salt'
                ? 'Fresh food rather than salty packaged food lifts the score.'
                : 'A meal built round veg and some protein would lift it.';
  }

  return { score, early, calories: Math.round(totals.calories), reasons: shown, tip };
}
