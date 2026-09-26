import type { MealEntry } from '../types';
import { ScoreMeter } from './charts';
import { SparkIcon } from './icons';
import { formatEnergy } from '../lib/region';
import { t } from '../lib/i18n';

const SLOT_EMOJI: Record<MealEntry['slot'], string> = {
  breakfast: '🌅',
  lunch: '🥗',
  dinner: '🍲',
  snack: '🍎',
};

export function MealCard({ meal, onClick }: { meal: MealEntry; onClick?: () => void }) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper type={onClick ? 'button' : undefined} className="meal-card" onClick={onClick}>
      {meal.photo ? (
        <img className="thumb" src={meal.photo} alt="" />
      ) : (
        <span className="thumb thumb--emoji" aria-hidden="true">
          {meal.items[0]?.emoji ?? SLOT_EMOJI[meal.slot]}
        </span>
      )}
      <span className="meal-card-body">
        <span className="meal-card-title">
          {/* The ellipsis needs a non-flex box to happen in. */}
          <span className="meal-card-name" dir="auto">{meal.title}</span>
          {meal.source === 'photo' && <SparkIcon size={14} className="meal-card-ai" />}
        </span>
        <span className="tiny muted meal-card-macros">
          {meal.time} · {formatEnergy(meal.nutrients.calories)} ·{' '}
          {t('P{protein} C{carbs} F{fat}', {
            protein: Math.round(meal.nutrients.protein),
            carbs: Math.round(meal.nutrients.carbs),
            fat: Math.round(meal.nutrients.fat),
          })}
        </span>
      </span>
      <ScoreMeter score={meal.score} size={40} />
    </Wrapper>
  );
}

export default MealCard;
