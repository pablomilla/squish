import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../App';
import type { MealEntry, MealSlot } from '../types';
import MealCard from '../components/MealCard';
import Squish from '../components/Squish';
import { MacroBars, MinorNutrients, OverTargetNote, ProgressRing, ScoreMeter } from '../components/charts';
import { Sheet, Stepper, useToast } from '../components/ui';
import { CameraIcon, ChevronIcon, PenIcon, PlusIcon, TrashIcon } from '../components/icons';
import { useSquish } from '../store/useSquish';
import { addDays, friendlyDate, isoDate, lastDays, weekdayLetter } from '../lib/date';
import { dayScore, mealsOn, totalsOn } from '../lib/selectors';
import { GLASS_ML, dayVerdict } from '../lib/nutrition';
import { WeightField } from '../components/fields';
import './diary.css';
import { describePortion } from '../lib/units';

const SLOTS: { key: MealSlot; label: string; emoji: string }[] = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { key: 'lunch', label: 'Lunch', emoji: '🥗' },
  { key: 'dinner', label: 'Dinner', emoji: '🍲' },
  { key: 'snack', label: 'Snacks', emoji: '🍎' },
];

export default function Diary({ go, onEditMeal }: { go: (route: Route) => void; onEditMeal: (meal: MealEntry) => void }) {
  const toast = useToast();
  const { meals, days, targets, removeMeal, setWater, setSteps, setWeight, profile } = useSquish();
  const [date, setDate] = useState(isoDate());
  const [selected, setSelected] = useState<MealEntry | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // The strip runs oldest → newest, so bring the chosen day into view.
  useEffect(() => {
    stripRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [date]);

  const strip = useMemo(() => lastDays(14, isoDate()), []);
  const dayMeals = useMemo(() => mealsOn(meals, date), [meals, date]);
  const totals = useMemo(() => totalsOn(meals, date), [meals, date]);
  const day = days[date];
  const score = dayScore(meals, date);
  const verdict = dayVerdict(score, totals, targets);

  return (
    <div className="screen diary">
      <header className="screen-head">
        <div>
          <h1>Your diary</h1>
          <p>{friendlyDate(date)}</p>
        </div>
        <button type="button" className="btn btn--sm" onClick={() => go({ name: 'capture', date })}>
          <PlusIcon size={16} /> Log
        </button>
      </header>

      <div className="date-strip" role="tablist" aria-label="Choose a day" ref={stripRef}>
        {strip.map((d) => {
          const logged = mealsOn(meals, d).length > 0;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === date}
              className={`date-pill ${d === date ? 'is-on' : ''}`}
              onClick={() => setDate(d)}
            >
              <span className="tiny">{weekdayLetter(d)}</span>
              <b>{Number(d.slice(-2))}</b>
              <span className={`date-dot ${logged ? 'is-on' : ''}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <section className="card diary-summary">
        <div className="row" style={{ gap: 16 }}>
          <ProgressRing value={totals.calories} target={targets.calories} size={132} />
          <div className="grow stack">
            <div className="row-between diary-verdict">
              <span className="small muted">Day score</span>
              {score > 0 ? (
                <span className={`badge badge--${verdict.tone}`}>
                  {verdict.tone === 'none' ? verdict.label : `${score} ${verdict.label}`}
                </span>
              ) : (
                <span className="badge">Nothing logged</span>
              )}
            </div>
            <MacroBars totals={totals} targets={targets} compact />
          </div>
        </div>
        {/* Sugar and salt were on the home screen and the review sheet but never
            here, which is the screen people actually go back through. */}
        <MinorNutrients totals={totals} targets={targets} />
        <OverTargetNote over={verdict.over} />
      </section>

      {SLOTS.map(({ key, label, emoji }) => {
        const list = dayMeals.filter((m) => m.slot === key);
        const kcal = Math.round(list.reduce((sum, m) => sum + m.nutrients.calories, 0));
        return (
          <section className={`card ${list.length ? '' : 'card--quiet'}`} key={key}>
            <div className="card-title">
              <h3>
                <span aria-hidden="true">{emoji}</span> {label}
              </h3>
              <span className="tiny muted">{kcal} kcal</span>
            </div>
            {list.length === 0 ? (
              <div className="slot-empty">
                <p className="tiny muted">Nothing yet</p>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="chip" onClick={() => go({ name: 'capture', slot: key, date })}>
                    <CameraIcon size={15} /> Snap
                  </button>
                  <button type="button" className="chip" onClick={() => go({ name: 'add', slot: key, date, tab: 'search' })}>
                    <PlusIcon size={15} /> Add
                  </button>
                </div>
              </div>
            ) : (
              <div className="stack">
                {list.map((meal) => (
                  <MealCard key={meal.id} meal={meal} onClick={() => setSelected(meal)} />
                ))}
                <button type="button" className="btn--quiet small row" onClick={() => go({ name: 'add', slot: key, date, tab: 'search' })}>
                  <PlusIcon size={15} /> Add to {label.toLowerCase()}
                </button>
              </div>
            )}
          </section>
        );
      })}

      <section className="card">
        <div className="card-title">
          <h3>Daily check-ins</h3>
        </div>
        <div className="row-between diary-tracker">
          <span className="small">
            💧 Water<span className="tiny muted"> · {GLASS_ML} ml</span>
          </span>
          <Stepper value={day?.water ?? 0} min={0} max={20} onChange={(v) => setWater(date, v)} suffix="glasses" />
        </div>
        <div className="row-between diary-tracker">
          <span className="small">👟 Steps</span>
          <Stepper value={day?.steps ?? 0} step={500} min={0} max={50000} onChange={(v) => setSteps(date, v)} />
        </div>
        <div className="diary-tracker diary-tracker--field">
          <span className="small">⚖️ Weight</span>
          {/* The shared field, so stones stay stones — the diary used to be the
              one place that insisted on plain pounds. */}
          <WeightField
            label="Weight"
            kg={day?.weightKg ?? profile.weightKg}
            units={profile.units}
            onChange={(kg) => setWeight(date, kg)}
          />
        </div>
      </section>

      {dayMeals.length === 0 && (
        <div className="empty">
          <Squish mood={date === isoDate() ? 'calm' : 'sleepy'} size={104} />
          <p style={{ marginTop: 8 }}>
            {date === isoDate() ? "Today's a blank page — let's fill it in." : 'Nothing was logged on this day.'}
          </p>
        </div>
      )}

      <div className="row-between" style={{ marginTop: 4 }}>
        <button type="button" className="btn--quiet small" onClick={() => setDate(addDays(date, -1))}>
          ← {friendlyDate(addDays(date, -1))}
        </button>
        {date !== isoDate() && (
          <button type="button" className="btn--quiet small row" onClick={() => setDate(addDays(date, 1))}>
            {friendlyDate(addDays(date, 1))} <ChevronIcon size={16} />
          </button>
        )}
      </div>

      <Sheet open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title}>
        {selected && (
          <div className="stack">
            {selected.photo && <img src={selected.photo} alt="" className="review-photo" />}
            <div className="row" style={{ gap: 12 }}>
              <ScoreMeter score={selected.score} size={54} />
              <div>
                <b style={{ fontSize: 24 }}>{Math.round(selected.nutrients.calories)} kcal</b>
                <p className="tiny muted">
                  {selected.time} · {selected.slot} · {selected.source === 'photo' ? 'photo analysis' : 'logged by hand'}
                </p>
              </div>
            </div>

            <MacroBars totals={selected.nutrients} targets={targets} compact />
            <MinorNutrients totals={selected.nutrients} targets={targets} />

            <div className="card card--tint card--flat">
              {selected.items.map((item) => (
                <div className="list-row" key={item.id}>
                  <span className="thumb thumb--emoji" aria-hidden="true">{item.emoji ?? '🍽️'}</span>
                  <span className="grow">
                    <b className="small">{item.name}</b>
                    <p className="tiny muted">{describePortion(item.portion, item.grams, item.liquid)}</p>
                  </span>
                  <span className="small">{Math.round(item.nutrients.calories)} kcal</span>
                </div>
              ))}
            </div>

            {selected.coachNote && <p className="speech">{selected.coachNote}</p>}
            {selected.note && <p className="small muted">"{selected.note}"</p>}

            <div className="row" style={{ gap: 10 }}>
              <button
                type="button"
                className="btn btn--ghost grow"
                onClick={() => {
                  const meal = selected;
                  setSelected(null);
                  onEditMeal(meal);
                }}
              >
                <PenIcon size={17} /> Edit
              </button>
              <button
                type="button"
                className="btn btn--danger grow"
                onClick={() => {
                  removeMeal(selected.id);
                  setSelected(null);
                  toast('Meal removed', '🗑️');
                }}
              >
                <TrashIcon size={17} /> Delete
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
