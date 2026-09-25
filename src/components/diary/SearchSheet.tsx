import { useMemo, useState } from 'react';
import { Sheet } from '../ui';
import { SearchIcon } from '../icons';
import { isoDate, parseISO } from '../../lib/date';
import { searchMeals } from '../../lib/diaryNav';
import { useSquish } from '../../store/useSquish';
import type { MealEntry } from '../../types';

const SLOT_WORDS: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

/** A date with its year only when it is not this one. */
const when = (iso: string) => {
  const d = parseISO(iso);
  const thisYear = iso.slice(0, 4) === isoDate().slice(0, 4);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(thisYear ? {} : { year: 'numeric' }) });
};

/**
 * "When did I last have lasagne?" Every meal ever logged, searched on the
 * phone, newest first. Picking one goes to its day and opens it.
 */
export default function SearchSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (meal: MealEntry) => void }) {
  const meals = useSquish((s) => s.meals);
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchMeals(meals, query), [meals, query]);
  const searching = query.trim().length >= 2;

  return (
    <Sheet open={open} onClose={onClose} title="Search your meals">
      <div className="meal-search">
        <label className="meal-search-box">
          <SearchIcon size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Lasagne, porridge, sushi…"
            aria-label="Search your meals"
            autoFocus
            enterKeyHint="search"
          />
        </label>

        {!searching ? (
          <p className="tiny muted">Every meal you have logged, searched on your phone. Try a dish or an ingredient.</p>
        ) : hits.length === 0 ? (
          <p className="small muted">Nothing matching “{query.trim()}” yet.</p>
        ) : (
          <>
            <p className="tiny muted">
              {hits.length === 60 ? 'The 60 most recent' : hits.length} {hits.length === 1 ? 'meal' : 'meals'}
            </p>
            <ul className="meal-search-results">
              {hits.map(({ meal, items }) => (
                <li key={meal.id}>
                  <button
                    type="button"
                    className="meal-search-hit"
                    onClick={() => {
                      onPick(meal);
                      onClose();
                    }}
                  >
                    <span className="tiny muted">
                      {when(meal.date)} · {SLOT_WORDS[meal.slot] ?? meal.slot}
                    </span>
                    <b className="small">{meal.title}</b>
                    {items.length > 0 && <span className="tiny muted">{items.join(', ')}</span>}
                    <span className="tiny muted meal-search-kcal">{Math.round(meal.nutrients.calories)} kcal</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}
