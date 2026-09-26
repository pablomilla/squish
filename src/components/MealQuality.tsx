import { mealLabel } from '../lib/nutrition';
import { explainMeal } from '../lib/dayExplained';
import ScoreReasons from './ScoreReasons';
import type { FoodItem, Nutrients } from '../types';
import { aboutEnergy } from '../lib/region';
import { t } from '../lib/i18n';

/**
 * Why a meal scored what it did: the label, the line that separates quality
 * from calories, and what lifted or lowered it. Folded away on the review
 * screen, where the score moves as items are changed; open in the diary.
 */
export default function MealQuality({
  meal,
  folded = false,
}: {
  meal: { nutrients: Nutrients; items: FoodItem[]; score?: number };
  folded?: boolean;
}) {
  const { score, reasons, small } = explainMeal(meal.nutrients, meal.items);
  if (score <= 0) return null;
  // A meal keeps the score it was saved with. If the way scores are worked
  // out has changed since, say so rather than explain a number it no longer has.
  const saved = meal.score && Math.abs(meal.score - score) >= 2 ? meal.score : null;
  const body = (
    <>
      <p className="tiny muted" style={{ margin: '0 0 8px' }}>
        {t('Food quality is about what this was made of, out of 100 — not how much.')} {mealLabel(score)}.
        {small && ` ${t('Small snacks are judged gently: under about {energy} the marks against them fade out.', { energy: aboutEnergy(100) })}`}
        {saved !== null && ` ${t("It was saved as {saved} under an earlier version of the score; by today's rules it is {score}.", { saved, score })}`}
      </p>
      {reasons.length > 0 && <ScoreReasons reasons={reasons} />}
    </>
  );
  return folded ? (
    <details className="meal-quality">
      <summary className="small">{t('Why {score}?', { score })}</summary>
      <div style={{ marginTop: 8 }}>{body}</div>
    </details>
  ) : (
    <div className="meal-quality card card--tint card--flat">
      <b className="small">{t('Why it scored {score}', { score })}</b>
      <div style={{ marginTop: 6 }}>{body}</div>
    </div>
  );
}
