import { useEffect, useMemo, useState } from 'react';
import type { Draft, FoodItem, MealSlot, Nutrients } from '../types';
import Squish from '../components/Squish';
import { MacroBars, MacroSplitBar, MinorNutrients, ScoreMeter } from '../components/charts';
import DictateButton from '../components/DictateButton';
import { Segmented, Sheet, Stepper, useToast } from '../components/ui';
import { ChevronIcon, CloseIcon, HeartIcon, PlusIcon, SearchIcon, SparkIcon, TrashIcon } from '../components/icons';
import { NumberField } from '../components/fields';
import { useSquish } from '../store/useSquish';
import { isPaywalled, refineAnalysis } from '../lib/api';
import { savePhoto } from '../lib/photos';
import { searchFoods, toFoodItem, type FoodRecord } from '../lib/foods';
import { EMPTY, qualityScore, round1, scaleNutrients, scoreLabel, sumNutrients, ultraProcessedShare } from '../lib/nutrition';
import { friendlyDate } from '../lib/date';
import './review.css';
import { describePortion } from '../lib/units';

/** The corrections people actually make to a scan, one tap each. */
const HOW_MUCH = [
  { label: 'Half', factor: 0.5 },
  { label: 'As scanned', factor: 1 },
  { label: 'Double', factor: 2 },
];

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
  const { targets, addMeal, updateMeal, toggleFavourite, isFavourite, setPendingMeal } = useSquish();
  const { analysis } = draft;

  const [title, setTitle] = useState(analysis.title);
  const [slot, setSlot] = useState<MealSlot>(draft.slot);
  const [rows, setRows] = useState<Row[]>(analysis.items.map(makeRow));
  const [note, setNote] = useState(draft.note ?? '');
  /** The food picker, open either to add a food or to swap one out. */
  const [picker, setPicker] = useState<{ replacing?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [fix, setFix] = useState('');
  const [fixing, setFixing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const items = useMemo(() => rows.map((row) => scaledItem(row)), [rows]);
  const totals = useMemo(() => (items.length ? sumNutrients(items) : { ...EMPTY }), [items]);
  const upfShare = useMemo(() => ultraProcessedShare(items), [items]);
  const score = useMemo(() => (items.length ? qualityScore(totals, upfShare) : 0), [items, totals, upfShare]);
  const verdict = scoreLabel(score);
  const results = useMemo(() => searchFoods(query, 10), [query]);

  /*
   * Keep the meal as it is corrected, so that leaving this screen by any
   * route other than the two buttons does not throw it away.
   *
   * Only new meals: abandoning an edit loses nothing, because the meal it was
   * editing is still in the diary and putting a half-finished copy of it in
   * the way would be worse than doing nothing.
   *
   * Held for a moment first. Every write goes through to localStorage, and
   * the title field would otherwise do one per keystroke with the photo
   * along for the ride.
   */
  useEffect(() => {
    if (draft.editingId || !items.length) return;
    const timer = setTimeout(
      () =>
        setPendingMeal({
          analysis: { ...analysis, title, items, nutrients: totals, score },
          photo: draft.photo,
          slot,
          date: draft.date,
          note: note.trim() || undefined,
        }),
      700,
    );
    return () => clearTimeout(timer);
  }, [analysis, draft.editingId, draft.photo, draft.date, items, note, score, setPendingMeal, slot, title, totals]);

  const setFactor = (id: string, factor: number) =>
    setRows((list) => list.map((row) => (row.item.id === id ? { ...row, factor: Math.max(0.05, factor) } : row)));

  /** Set the amount itself rather than a multiple of it — 568 ml, not "× 2". */
  const setAmount = (id: string, amount: number) =>
    setRows((list) =>
      list.map((row) => (row.item.id === id && row.baseGrams ? { ...row, factor: Math.max(0.05, amount / row.baseGrams) } : row)),
    );

  /** Hand the whole meal back to Squish with the correction in plain words. */
  const applyFix = async () => {
    const instruction = fix.trim();
    if (!instruction || fixing) return;
    setFixing(true);
    try {
      const corrected = await refineAnalysis({ ...analysis, items, title, nutrients: totals, score }, instruction, slot);
      setRows(corrected.items.map(makeRow));
      if (corrected.title?.trim()) setTitle(corrected.title.trim());
      setOpenRow(null);
      setFix('');
      toast('Sorted — have a look', '✨');
    } catch (error) {
      if (!isPaywalled(error)) toast(error instanceof Error ? error.message : 'I could not work that out.', '😅');
    } finally {
      setFixing(false);
    }
  };

  const chooseFood = (food: FoodRecord) => {
    const swapped = makeRow(toFoodItem(food));
    setRows((list) => (picker?.replacing ? list.map((r) => (r.item.id === picker.replacing ? swapped : r)) : [...list, swapped]));
    setOpenRow(picker?.replacing ? swapped.item.id : null);
    setPicker(null);
    setQuery('');
  };

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

    setPendingMeal(null);

    if (draft.editingId) {
      updateMeal(draft.editingId, payload);
      // Only when this edit brought a new photograph with it. Editing the
      // title of a meal photographed last week must not wipe its picture.
      if (draft.photoFull) void savePhoto(draft.editingId, draft.photoFull);
      toast('Meal updated', '✏️');
    } else {
      const saved = addMeal(payload);
      // The diary keeps the thumbnail; the photograph goes beside it, under
      // the meal's id. Not awaited — the meal is saved either way, and a
      // picture that failed to store is a smaller loss than a wait.
      if (draft.photoFull) void savePhoto(saved.id, draft.photoFull);
      /*
       * The one place to teach the word, because it cannot be misread here:
       * they have just done the thing, so "squished it" defines itself. The
       * button above still says Save meal, and always will — a coined verb
       * belongs in Squish's voice, never on the control somebody has to press
       * to keep their dinner.
       */
      toast(`Squished it — ${Math.round(totals.calories)} kcal logged.`, '🎉');
    }
    onDone();
  };

  const throwAway = () => {
    setPendingMeal(null);
    onCancel();
  };

  /** The X. It asks, because it is the one button here that destroys work. */
  const leave = () => {
    if (draft.editingId || !items.length) {
      throwAway();
      return;
    }
    setLeaving(true);
  };

  return (
    <div className="screen review">
      <header className="review-top">
        <button type="button" className="btn--quiet" onClick={leave} aria-label="Cancel">
          <CloseIcon />
        </button>
        <span className="tiny muted">{friendlyDate(draft.date)}</span>
        {/* A real button, and it stays put while the rest of the screen
            scrolls under it. Meals were being lost to a save that was one
            scroll below wherever anybody had got to. */}
        <button type="button" className="btn btn--sm" onClick={save}>
          {draft.editingId ? 'Update meal' : 'Save meal'}
        </button>
      </header>

      {/* The full one while it is in hand; the thumbnail for a recovered draft. */}
      {(draft.photoFull ?? draft.photo) && (
        <img className="review-photo" src={draft.photoFull ?? draft.photo} alt="The meal you logged" />
      )}

      <div className="review-title-row">
        <input className="input review-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Meal name" />
        <ScoreMeter score={score} size={52} />
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`badge badge--${verdict.tone}`}>{verdict.tone === 'none' ? verdict.label : `${verdict.label} meal`}</span>
        {/* Stated, not scolded. It is the one thing the numbers below cannot
            show, and without it a lower score has no visible reason. */}
        {upfShare >= 0.5 && (
          <span className="badge" title="Made in a factory from refined ingredients rather than cooked from food. It counts against the score.">
            {upfShare >= 0.95 ? 'Ultra-processed' : 'Mostly ultra-processed'}
          </span>
        )}
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
        <MinorNutrients totals={totals} targets={targets} />
        <div className="divider" />
        <MacroSplitBar totals={totals} />
      </div>

      <section className="card">
        <div className="card-title">
          <h3>Items</h3>
          <button type="button" className="btn--quiet small row" onClick={() => setPicker({})}>
            <PlusIcon size={16} /> Add
          </button>
        </div>

        {items.length > 0 && (
          <p className="tiny muted" style={{ marginTop: -6, marginBottom: 6 }}>
            Squish guessed these. Tap any one to change the amount or swap it for something else.
          </p>
        )}

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
                  <ChevronIcon size={16} className={`item-chevron ${open ? 'is-open' : ''}`} />
                </button>

                {open && (
                  <div className="item-edit">
                    <p className="tiny muted">How much was it?</p>
                    <div className="amount-chips">
                      {HOW_MUCH.map((choice) => (
                        <button
                          key={choice.label}
                          type="button"
                          className="chip"
                          aria-pressed={Math.abs(row.factor - choice.factor) < 0.02}
                          onClick={() => setFactor(row.item.id, choice.factor)}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>

                    {row.baseGrams ? (
                      <NumberField
                        label={`Or set it exactly${item.liquid ? ' (ml)' : ' (g)'}`}
                        value={Math.round(row.baseGrams * row.factor)}
                        suffix={item.liquid ? 'ml' : 'g'}
                        min={1}
                        max={5000}
                        onChange={(amount) => setAmount(row.item.id, amount)}
                      />
                    ) : (
                      <div className="row-between" style={{ marginTop: 10 }}>
                        <span className="small muted">Portions</span>
                        <Stepper value={row.factor} step={0.25} min={0.25} max={12} onChange={(factor) => setFactor(row.item.id, factor)} suffix="×" />
                      </div>
                    )}

                    <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          setQuery(row.item.name);
                          setPicker({ replacing: row.item.id });
                        }}
                      >
                        <SearchIcon size={15} /> Not this — swap it
                      </button>
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

      <section className="card fix-card">
        <label htmlFor="fix" className="small">
          <SparkIcon size={16} /> Something not right?
        </label>
        <p className="tiny muted">
          Tell Squish in your own words — "two eggs, not one", "no cheese", "grilled not fried".
        </p>
        <div className="fix-row">
          <input
            id="fix"
            className="input"
            value={fix}
            disabled={fixing}
            placeholder="There were two eggs, not one"
            onChange={(e) => setFix(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void applyFix();
              }
            }}
          />
          <button type="button" className="btn btn--soft" disabled={!fix.trim() || fixing} onClick={() => void applyFix()}>
            {fixing ? 'Thinking…' : 'Fix it'}
          </button>
        </div>
        {/* Corrections are short and said out loud faster than typed, and this
            is the screen someone is on with a plate in front of them. */}
        <DictateButton
          label="your correction"
          onText={(text) => setFix((current) => (current ? `${current.trim()} ${text}` : text))}
          onError={(message) => toast(message, '🎤')}
        />
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

      <Sheet open={leaving} onClose={() => setLeaving(false)} title="Save this meal?">
        <p className="small muted">
          {Math.round(totals.calories)} kcal across {items.length} food{items.length === 1 ? '' : 's'}. Throw it away and
          you will have to log it again.
        </p>
        <div className="stack" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn--block" onClick={save}>
            Save it
          </button>
          <button type="button" className="btn btn--block btn--danger" onClick={throwAway}>
            Throw it away
          </button>
        </div>
      </Sheet>

      <Sheet
        open={picker !== null}
        onClose={() => {
          setPicker(null);
          setQuery('');
        }}
        title={picker?.replacing ? 'Swap this for…' : 'Add a food'}
      >
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
              onClick={() => chooseFood(food)}
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
    // The words described the amount that was scanned, so once that amount
    // changes they are stale — 568 ml is not "half a pint", however many of
    // them it is. The measure says it instead. Only when there is no measure
    // to show does the multiplier have to carry it.
    portion: row.baseGrams ? '' : `${round1(row.factor)} × ${row.basePortion}`,
    grams: row.baseGrams ? Math.round(row.baseGrams * row.factor) : undefined,
    nutrients: scaleNutrients(row.base, row.factor),
  };
}
