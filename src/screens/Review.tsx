import { useMemo, useState } from 'react';
import type { Draft } from '../App';
import type { FoodItem, MealSlot, Nutrients } from '../types';
import Squish from '../components/Squish';
import { MacroBars, MacroSplitBar, ScoreMeter } from '../components/charts';
import { Segmented, Sheet, Stepper, useToast } from '../components/ui';
import { CloseIcon, HeartIcon, PlusIcon, SearchIcon, SparkIcon, TrashIcon } from '../components/icons';
import { useSquish } from '../store/useSquish';
import { searchFoods, toFoodItem } from '../lib/foods';
import { EMPTY, qualityScore, round1, scaleNutrients, scoreLabel, sumNutrients } from '../lib/nutrition';
import { friendlyDate } from '../lib/date';
import './review.css';
import { describePortion } from '../lib/units';

interface Row {
  item: FoodItem;
  base: Nutrients;
  baseGrams?: number;
  basePortion: string;
  factor: number;
}

const makeRow = (item: FoodItem): Row => ({
  item,
  base: item.nutrients,
  baseGrams: item.grams,
  basePortion: item.portion,
  factor: 1,
});

export default function Review({ draft, onDone, onCancel }: { draft: Draft; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const { targets, addMeal, updateMeal, toggleFavourite, isFavourite } = useSquish();
  const { analysis } = draft;

  const [title, setTitle] = useState(analysis.title);
  const [slot, setSlot] = useState<MealSlot>(draft.slot);
  const [rows, setRows] = useState<Row[]>(analysis.items.map(makeRow));
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [openRow, setOpenRow] = useState<string | null>(null);

  const items = useMemo(() => rows.map((row) => scaledItem(row)), [rows]);
  const totals = useMemo(() => (items.length ? sumNutrients(items) : { ...EMPTY }), [items]);
  const score = useMemo(() => (items.length ? qualityScore(totals) : 0), [items, totals]);
  const verdict = scoreLabel(score);
  const results = useMemo(() => searchFoods(query, 10), [query]);

  const setFactor = (id: string, factor: number) =>
    setRows((list) => list.map((row) => (row.item.id === id ? { ...row, factor: Math.max(0.25, factor) } : row)));

  const save = () => {
    if (!items.length) {
      toast('Add at least one food first.', '🥄');
      return;
    }
    const payload = {
      slot,
      title: title.trim() || 'Meal',
      items,
      nutrients: totals,
      score,
      note: note.trim() || undefined,
      coachNote: analysis.coachNote,
      photo: draft.photo,
      source: (draft.photo ? 'photo' : 'describe') as 'photo' | 'describe',
      aiConfidence: analysis.confidence,
      date: draft.date,
    };

    if (draft.editingId) {
      updateMeal(draft.editingId, payload);
      toast('Meal updated', '✏️');
    } else {
      addMeal(payload);
      toast(`${Math.round(totals.calories)} kcal logged — nice one!`, '🎉');
    }
    onDone();
  };

  return (
    <div className="screen review">
      <header className="review-top">
        <button type="button" className="btn--quiet" onClick={onCancel} aria-label="Cancel">
          <CloseIcon />
        </button>
        <span className="tiny muted">{friendlyDate(draft.date)}</span>
        <button type="button" className="btn--quiet small" onClick={save}>
          {draft.editingId ? 'Update' : 'Save'}
        </button>
      </header>

      {draft.photo && <img className="review-photo" src={draft.photo} alt="The meal you logged" />}

      <div className="review-title-row">
        <input className="input review-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Meal name" />
        <ScoreMeter score={score} size={52} />
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`badge badge--${verdict.tone}`}>{verdict.label} meal</span>
        {analysis.offline ? (
          <span className="badge badge--warn" title="No model was reachable, so these numbers come from the offline estimator">
            Offline estimate
          </span>
        ) : (
          <span className="badge">
            <SparkIcon size={13} /> AI · {analysis.confidence} confidence
          </span>
        )}
      </div>

      {analysis.coachNote && (
        <div className="review-coach">
          <Squish mood={score >= 55 ? 'nomnom' : 'calm'} size={74} bob={false} />
          <p className="speech">{analysis.coachNote}</p>
        </div>
      )}

      <div className="card review-totals">
        <div className="review-kcal">
          <b>{Math.round(totals.calories)}</b>
          <span className="muted small">kcal · {Math.round((totals.calories / targets.calories) * 100)}% of today</span>
        </div>
        <MacroBars totals={totals} targets={targets} compact />
        <div className="divider" />
        <MacroSplitBar totals={totals} />
      </div>

      <section className="card">
        <div className="card-title">
          <h3>Items</h3>
          <button type="button" className="btn--quiet small row" onClick={() => setAdding(true)}>
            <PlusIcon size={16} /> Add
          </button>
        </div>

        {items.length === 0 && <p className="empty">Nothing here yet — add the foods you ate.</p>}

        <div>
          {rows.map((row) => {
            const item = scaledItem(row);
            const open = openRow === row.item.id;
            return (
              <div className="item-row" key={row.item.id}>
                <button type="button" className="item-main" onClick={() => setOpenRow(open ? null : row.item.id)}>
                  <span className="thumb thumb--emoji" aria-hidden="true">{item.emoji ?? '🍽️'}</span>
                  <span className="item-text">
                    <b>{item.name}</b>
                    <span className="tiny muted">
                      {describePortion(item.portion, item.grams, item.liquid)} · {Math.round(item.nutrients.calories)} kcal
                    </span>
                  </span>
                  <span className="tiny muted item-macros">
                    {Math.round(item.nutrients.protein)}P · {Math.round(item.nutrients.carbs)}C · {Math.round(item.nutrients.fat)}F
                  </span>
                </button>

                {open && (
                  <div className="item-edit">
                    <div className="row-between">
                      <span className="small muted">Portion</span>
                      <Stepper value={row.factor} step={0.25} min={0.25} max={12} onChange={(factor) => setFactor(row.item.id, factor)} suffix="×" />
                    </div>
                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => toggleFavourite(item)}
                        aria-pressed={isFavourite(item.name)}
                      >
                        <HeartIcon size={15} /> {isFavourite(item.name) ? 'Saved' : 'Favourite'}
                      </button>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          setRows((list) => list.filter((r) => r.item.id !== row.item.id));
                          setOpenRow(null);
                        }}
                      >
                        <TrashIcon size={15} /> Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="field">
        <label htmlFor="meal-slot">Meal</label>
        <Segmented<MealSlot>
          label="Meal"
          value={slot}
          onChange={setSlot}
          options={[
            { value: 'breakfast', label: 'Breakfast' },
            { value: 'lunch', label: 'Lunch' },
            { value: 'dinner', label: 'Dinner' },
            { value: 'snack', label: 'Snack' },
          ]}
        />
      </div>

      <div className="field">
        <label htmlFor="note">Note (optional)</label>
        <textarea
          id="note"
          className="textarea"
          value={note}
          placeholder="How did it feel? Anything worth remembering?"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <button type="button" className="btn btn--block" onClick={save}>
        {draft.editingId ? 'Update meal' : 'Save meal'}
      </button>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a food">
        <div className="field">
          <label htmlFor="add-search" className="visually-hidden">Search foods</label>
          <div className="search-wrap">
            <SearchIcon />
            <input
              id="add-search"
              className="input"
              value={query}
              autoFocus
              placeholder="Search 80+ everyday foods"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="stack" style={{ marginTop: 8 }}>
          {results.map((food) => (
            <button
              key={food.id}
              type="button"
              className="meal-card"
              onClick={() => {
                setRows((list) => [...list, makeRow(toFoodItem(food))]);
                setAdding(false);
                setQuery('');
              }}
            >
              <span className="thumb thumb--emoji" aria-hidden="true">{food.emoji}</span>
              <span className="meal-card-body">
                <span className="meal-card-title">{food.name}</span>
                <span className="tiny muted">
                  {describePortion(food.serving, food.servingG, food.tags.includes('drink'))} ·{' '}
                  {Math.round((food.per100.calories * food.servingG) / 100)} kcal
                </span>
              </span>
              <PlusIcon size={18} />
            </button>
          ))}
          {results.length === 0 && <p className="empty">No match — try a simpler word like "rice".</p>}
        </div>
      </Sheet>
    </div>
  );
}

function scaledItem(row: Row): FoodItem {
  if (row.factor === 1) return { ...row.item, nutrients: row.base, portion: row.basePortion, grams: row.baseGrams };
  return {
    ...row.item,
    portion: `${round1(row.factor)} × ${row.basePortion}`,
    grams: row.baseGrams ? Math.round(row.baseGrams * row.factor) : undefined,
    nutrients: scaleNutrients(row.base, row.factor),
  };
}
