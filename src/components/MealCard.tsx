import type { MealEntry } from '../types';
import { ScoreMeter } from './charts';
import { SparkIcon } from './icons';

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
          {meal.title}
          {meal.source === 'photo' && <SparkIcon size={14} className="meal-card-ai" />}
        </span>
        <span className="tiny muted">
          {meal.time} · {Math.round(meal.nutrients.calories)} kcal · P {Math.round(meal.nutrients.protein)}g · C{' '}
          {Math.round(meal.nutrients.carbs)}g · F {Math.round(meal.nutrients.fat)}g
        </span>
      </span>
      <ScoreMeter score={meal.score} size={40} />
    </Wrapper>
  );
}

export default MealCard;
