import { useEffect, useMemo, useState } from 'react';
import type { Route } from '../App';
import Squish from '../components/Squish';
import EmptyState from '../components/EmptyState';
import MealCard from '../components/MealCard';
import { MacroBars, MacroSplitBar, ProgressRing, StreakDots } from '../components/charts';
import { CameraIcon, ChevronIcon, DropIcon, HeartIcon, PenIcon, SearchIcon, ShoeIcon, FlameIcon } from '../components/icons';
import { WeightField } from '../components/fields';
import { Sheet } from '../components/ui';
import { formatWeight } from '../lib/units';
import { useSquish } from '../store/useSquish';
import { friendlyDate, greeting, isoDate, slotForNow, weekOf } from '../lib/date';
import { habitCount, habitsOn, mealsOn, moodFor, statusLine, streakOf, totalsOn } from '../lib/selectors';
import { pct, remaining } from '../lib/nutrition';
import { coachNudge } from '../lib/api';
import './home.css';

export default function Home({ go }: { go: (route: Route) => void }) {
  const today = isoDate();
  const { profile, targets, meals, days, unlock, setWater, setSteps, setWeight, lastCoachNote, rememberCoachNote } =
    useSquish();
  const [weighing, setWeighing] = useState(false);
  const day = days[today];

  const totals = useMemo(() => totalsOn(meals, today), [meals, today]);
  const todaysMeals = useMemo(() => mealsOn(meals, today), [meals, today]);
  const streak = useMemo(() => streakOf(meals, today), [meals, today]);
  const habits = habitsOn(meals, days, targets, today);
  const week = weekOf(today);
  const lastWeighIn = useMemo(
    () =>
      Object.values(days)
        .filter((entry) => entry.weightKg && entry.date !== today)
        .sort((a, b) => b.date.localeCompare(a.date))[0] as { date: string; weightKg: number } | undefined,
    [days, today],
  );
  const loggedThisWeek = week.map((d) => mealsOn(meals, d).length > 0);

  const situation = {
    hour: new Date().getHours(),
    mealsToday: todaysMeals.length,
    caloriesPct: pct(totals.calories, targets.calories),
    habits: habitCount(habits),
    streak,
  };
  const mood = moodFor(situation);

  // Daily achievements are awarded from live totals rather than at save time.
  useEffect(() => {
    if (totals.protein >= targets.protein) unlock('protein-hit');
    if (totals.fibre >= targets.fibre) unlock('fibre-hit');
    if (streak >= 3) unlock('streak-3');
    if (streak >= 7) unlock('streak-7');
    if (streak >= 30) unlock('streak-30');
  }, [totals.protein, totals.fibre, targets.protein, targets.fibre, streak, unlock]);

  // The stored note counts only while it still describes the day it was written
  // about. Log a meal and it is stale, so a fresh one is asked for and the live
  // fallback below covers the gap.
  const mealsLogged = todaysMeals.length;
  const nudge =
    lastCoachNote?.date === today && lastCoachNote.mealsLogged === mealsLogged ? lastCoachNote.message : null;

  useEffect(() => {
    if (nudge) return;
    let live = true;
    coachNudge({
      name: profile.name,
      goal: profile.goal,
      streak,
      caloriesEaten: totals.calories,
      caloriesTarget: targets.calories,
      protein: totals.protein,
      proteinTarget: targets.protein,
      fibre: totals.fibre,
      water: day?.water ?? 0,
      waterTarget: targets.water,
      mealsLogged,
      timeOfDay: slotForNow(),
      recentMeals: todaysMeals.map((m) => m.title),
    }).then((message) => {
      if (!live || !message) return;
      rememberCoachNote(message, mealsLogged);
    });
    return () => {
      live = false;
    };
    // Asked once per change of situation, not once per render: the rest of the
    // context is read fresh at call time.
  }, [nudge, mealsLogged, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const fallbackNudge = todaysMeals.length
    ? `${remaining(targets.calories, totals.calories)} kcal left today — and ${remaining(targets.protein, totals.protein)} g of protein to go.`
    : 'Ready for something delicious today?';

  return (
    <div className="screen home">
      <header className="home-top">
        <div>
          <p className="tiny muted">{greeting()}</p>
          <h1>{profile.name ? `Hi ${profile.name}` : 'Hello there'}</h1>
        </div>
        <div className="home-streak" title="Logging streak">
          <FlameIcon size={18} />
          <b>{streak}</b>
          <span className="tiny">day{streak === 1 ? '' : 's'}</span>
        </div>
      </header>

      <section className="home-hero card card--brand">
        <div className="home-hero-text">
          <p className="speech speech--right">{nudge ?? fallbackNudge}</p>
          <p className="script home-mood">{statusLine(situation)}</p>
        </div>
        <Squish mood={mood} size={116} />
      </section>

      <section className="card card--hero home-today">
        <div className="card-title">
          <h3>Today</h3>
          <span className="badge">
            {todaysMeals.length} meal{todaysMeals.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="home-ring-wrap">
          <ProgressRing value={totals.calories} target={targets.calories} size={196} />
          <p className="tiny muted home-ring-caption">
            {Math.round(totals.calories)} of {targets.calories} kcal
          </p>
        </div>

        {/* The macro bars already carry protein and fibre with their numbers —
            the stat pills that used to sit beside the ring said it twice. */}
        <MacroBars totals={totals} targets={targets} compact />
        {totals.calories > 0 && (
          <>
            <div className="divider" />
            <MacroSplitBar totals={totals} />
          </>
        )}
      </section>

      <section className="home-actions">
        <button type="button" className="action action--primary" onClick={() => go({ name: 'capture' })}>
          <CameraIcon size={22} />
          Snap a meal
        </button>
        <div className="home-actions-row">
          <button type="button" className="action" onClick={() => go({ name: 'add', tab: 'describe' })}>
            <PenIcon size={20} />
            Describe
          </button>
          <button type="button" className="action" onClick={() => go({ name: 'add', tab: 'search' })}>
            <SearchIcon size={20} />
            Search
          </button>
          <button type="button" className="action" onClick={() => go({ name: 'add', tab: 'favourites' })}>
            <HeartIcon size={20} />
            Saved
          </button>
        </div>
      </section>

      <p className="section-label">Today's habits</p>

      <section className="home-trackers">
        <div className="card card--quiet tracker">
          <div className="row-between">
            <span className="row tiny muted" style={{ gap: 6 }}>
              <DropIcon size={16} /> Water
            </span>
            <b className="small">
              {day?.water ?? 0}/{targets.water}
            </b>
          </div>
          <div className="glasses">
            {Array.from({ length: targets.water }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`glass ${i < (day?.water ?? 0) ? 'is-full' : ''}`}
                aria-label={`${i + 1} glass${i ? 'es' : ''} of water`}
                onClick={() => setWater(today, i + 1 === (day?.water ?? 0) ? i : i + 1)}
              />
            ))}
          </div>
        </div>

        <div className="card card--quiet tracker">
          <div className="row-between">
            <span className="row tiny muted" style={{ gap: 6 }}>
              <ShoeIcon size={16} /> Movement
            </span>
            <b className="small">
              {(day?.steps ?? 0).toLocaleString()} / {targets.steps.toLocaleString()}
            </b>
          </div>
          <div className="macro-track" style={{ marginTop: 10 }}>
            <span
              className="macro-fill"
              style={{ width: `${Math.min(100, ((day?.steps ?? 0) / targets.steps) * 100)}%`, background: 'var(--mint)' }}
            />
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
            {[1000, 2500, 5000].map((add) => (
              <button
                key={add}
                type="button"
                className="chip"
                aria-label={`Add ${add.toLocaleString()} steps`}
                onClick={() => setSteps(today, (day?.steps ?? 0) + add)}
              >
                +{add >= 1000 ? `${add / 1000}k` : add}
              </button>
            ))}
            {(day?.steps ?? 0) > 0 && (
              <button type="button" className="chip" onClick={() => setSteps(today, 0)}>
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      <button type="button" className="card card--quiet weigh-row" onClick={() => setWeighing(true)}>
        <span className="row" style={{ gap: 8 }}>
          <span aria-hidden="true">⚖️</span>
          <span className="small">Weight</span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <b className="small">{day?.weightKg ? formatWeight(day.weightKg, profile.units) : 'Tap to log'}</b>
          <ChevronIcon size={16} />
        </span>
      </button>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>This week</h3>
          <span className="tiny muted">{loggedThisWeek.filter(Boolean).length}/7 days logged</span>
        </div>
        <StreakDots dates={week} done={loggedThisWeek} />
        <div className="divider" />
        <div className="habit-grid">
          {[
            { key: 'meals', label: 'Meals', value: `${todaysMeals.length}/3`, on: habits.meals },
            { key: 'protein', label: 'Protein', value: `${Math.round(pct(totals.protein, targets.protein) * 100)}%`, on: habits.protein },
            { key: 'water', label: 'Water', value: `${day?.water ?? 0}/${targets.water}`, on: habits.water },
            { key: 'movement', label: 'Movement', value: `${Math.round(pct(day?.steps ?? 0, targets.steps) * 100)}%`, on: habits.movement },
          ].map((habit) => (
            <div key={habit.key} className={`habit ${habit.on ? 'is-on' : ''}`}>
              <span className="habit-check" aria-hidden="true">{habit.on ? '✓' : '○'}</span>
              <span className="tiny">{habit.label}</span>
              <b className="small">{habit.value}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h3>Today's meals</h3>
          <button type="button" className="btn--quiet small" onClick={() => go({ name: 'meals' })}>
            See all
          </button>
        </div>
        {todaysMeals.length === 0 ? (
          <EmptyState
            mood="calm"
            action={
              <button type="button" className="btn btn--soft btn--sm" onClick={() => go({ name: 'capture' })}>
                Snap your first meal
              </button>
            }
          >
            Nothing logged yet today — snap a meal and I'll do the maths.
          </EmptyState>
        ) : (
          <div className="stack">
            {todaysMeals.slice(-4).reverse().map((meal) => (
              <MealCard key={meal.id} meal={meal} onClick={() => go({ name: 'meals' })} />
            ))}
          </div>
        )}
      </section>

      <p className="script home-footer">Good food. Brighter days. ♡</p>

      <Sheet open={weighing} onClose={() => setWeighing(false)} title="Today's weight">
        <div className="stack">
          <WeightField
            label="Weight"
            kg={day?.weightKg ?? profile.weightKg}
            units={profile.units}
            onChange={(kg) => setWeight(today, kg)}
          />
          <p className="tiny muted">
            {lastWeighIn
              ? `Last logged ${formatWeight(lastWeighIn.weightKg, profile.units)} on ${friendlyDate(lastWeighIn.date)}.`
              : 'Weigh yourself at the same time of day — first thing is the steadiest.'}
          </p>
          <button type="button" className="btn btn--block" onClick={() => setWeighing(false)}>
            Done
          </button>
        </div>
      </Sheet>

    </div>
  );
}
