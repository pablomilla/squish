import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import TodayPlanning from '../components/TodayPlanning';
import type { Route } from '../types';
import Squish from '../components/Squish';
import EmptyState from '../components/EmptyState';
import MealCard from '../components/MealCard';
import { MacroBars, MacroSplitBar, MinorNutrients, OverTargetNote, ProgressRing, StreakDots } from '../components/charts';
import { CameraIcon, ChevronIcon, DropIcon, HeartIcon, PenIcon, SearchIcon, ShoeIcon, SparkIcon, FlameIcon } from '../components/icons';
import { WeightField } from '../components/fields';
import { Sheet } from '../components/ui';
import { formatWeight } from '../lib/units';
import { useSquish } from '../store/useSquish';
import Comparison from '../components/Comparison';
import { equivalentFor, progressWords, seedFrom, type GoodNutrient } from '../lib/equivalents';
import { friendlyDate, greeting, isoDate, partOfDay, timeOfDayWords, weekOf } from '../lib/date';
import { habitCount, habitsOn, habitTally, mealsOn, moodFor, statusLine, streakOf, totalsOn } from '../lib/selectors';
import { GLASS_ML, overTargets, pct, remaining, waterVolume } from '../lib/nutrition';
import { coachNudge } from '../lib/api';
import { sceneInUse } from '../lib/scenes';
import { sceneUrl } from '../components/sceneArt';
import { useSubscribed } from '../components/useSubscribed';
import FriendNudge from '../components/FriendNudge';
import SquadStrip from '../components/squad/SquadStrip';
import './home.css';

export default function Home({ go }: { go: (route: Route) => void }) {
  const today = isoDate();
  const { profile, targets, meals, days, setWater, setSteps, setWeight, lastCoachNote, rememberCoachNote, pendingMeal, setPendingMeal } =
    useSquish();
  const [weighing, setWeighing] = useState(false);
  const chosenScene = useSquish((s) => s.scene);
  const unlocked = useSquish((s) => s.unlocked);
  const subscribed = useSubscribed();
  const scene = sceneInUse(chosenScene, { unlocked, subscribed, today: new Date() });
  const day = days[today];

  const totals = useMemo(() => totalsOn(meals, today), [meals, today]);
  const todaysMeals = useMemo(() => mealsOn(meals, today), [meals, today]);
  const streak = useMemo(() => streakOf(meals, today), [meals, today]);
  const habits = habitsOn(meals, days, targets, today);
  const week = weekOf(today);
  // Counted across the whole week, which is what the card is headed — these
  // used to show today's status inside a card called "This week".
  const tally = useMemo(() => habitTally(meals, days, targets, week), [meals, days, targets, week]);
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

  // Badges are awarded from the diary by AchievementSync, whichever screen is open.

  // The stored note counts only while it still describes the day it was written
  // about. Log a meal and it is stale, so a fresh one is asked for and the live
  // fallback below covers the gap.
  const mealsLogged = todaysMeals.length;
  // One good thing about the day in food terms. Protein one day, fibre the
  // next, and a different food each day, so it stays worth reading.
  const dayComparison = useMemo(() => {
    const seed = seedFrom(today);
    const order: GoodNutrient[] = seed % 2 ? ['fibre', 'protein'] : ['protein', 'fibre'];
    for (const nutrient of order) {
      const equivalent = equivalentFor(nutrient, totals[nutrient], seed >> 1);
      if (equivalent) return { equivalent };
    }
    return null;
  }, [today, totals]);
  const part = partOfDay();
  const nudge =
    lastCoachNote?.date === today && lastCoachNote.mealsLogged === mealsLogged && lastCoachNote.part === part
      ? lastCoachNote.message
      : null;

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
      timeOfDay: timeOfDayWords(),
      recentMeals: todaysMeals.map((m) => m.title),
    }).then((message) => {
      if (!live || !message) return;
      rememberCoachNote(message, mealsLogged, part);
    });
    return () => {
      live = false;
    };
    // Asked once per change of situation, not once per render: the rest of the
    // context is read fresh at call time.
  }, [nudge, mealsLogged, today, part]); // eslint-disable-line react-hooks/exhaustive-deps

  const fallbackNudge = todaysMeals.length
    ? `${remaining(targets.calories, totals.calories)} kcal left today — and ${remaining(targets.protein, totals.protein)} g of protein to go.`
    // Asked as an opening rather than a reproach: "nothing squished yet" is a
    // blank page, and "you haven't squished anything" is a telling-off.
    : part === 'night'
      ? // Late on, "what's first?" reads as an invitation to eat. The day can simply end.
        'Nothing squished today — that’s fine. Tomorrow is a fresh page.'
      : 'Nothing squished yet — what’s first?';

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

      <section
        className={`home-hero card card--brand${scene ? ' home-hero--scene' : ''}`}
        style={
          scene
            ? ({ '--scene-light': `url("${sceneUrl(scene.id, 'light')}")`, '--scene-dark': `url("${sceneUrl(scene.id, 'dark')}")` } as CSSProperties)
            : undefined
        }
      >
        <div className="home-hero-text">
          <p className="speech speech--right">{nudge ?? fallbackNudge}</p>
          <p className="script home-mood">{statusLine(situation)}</p>
        </div>
        <Squish mood={mood} size={132} />
      </section>

      <FriendNudge onOpenYou={() => go({ name: 'you' })} />
      <SquadStrip onOpenYou={() => go({ name: 'you' })} />

      {/* A meal that was analysed and never saved. It is offered back rather
          than logged: nobody asked for it to go in the diary, and a tracker
          that logs food you did not confirm is a tracker you stop trusting. */}
      {pendingMeal && (
        <section className="card home-pending">
          <div className="card-title">
            <h3>Unfinished meal</h3>
            <span className="badge badge--warn">Not saved</span>
          </div>
          <p className="small">
            <b>{pendingMeal.analysis.title}</b> — {Math.round(pendingMeal.analysis.nutrients.calories)} kcal,{' '}
            {friendlyDate(pendingMeal.date).toLowerCase()}.
          </p>
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button type="button" className="btn btn--sm grow" onClick={() => go({ name: 'review', draft: pendingMeal })}>
              Finish it
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPendingMeal(null)}>
              Throw it away
            </button>
          </div>
        </section>
      )}

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
        {dayComparison && (
          <Comparison
            equivalent={dayComparison.equivalent}
            lead="The"
            tail={` so far${progressWords(totals[dayComparison.equivalent.nutrient], targets[dayComparison.equivalent.nutrient])}`}
          />
        )}
        <MinorNutrients totals={totals} targets={targets} />
        <OverTargetNote over={overTargets(totals, targets)} />
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
        <button type="button" className="action action--wide" onClick={() => go({ name: 'ask' })}>
          <SparkIcon size={20} />
          Ask the Squish Nutritionist
        </button>
      </section>

      <TodayPlanning go={go} />

      <p className="section-label">Daily check-ins</p>

      <section className="home-trackers">
        <div className="card card--quiet tracker">
          <div className="row-between">
            <span className="row tiny muted" style={{ gap: 6 }}>
              <DropIcon size={16} /> Water
            </span>
            <b className="small">
              {day?.water ?? 0}/{targets.water} glasses
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
          <p className="tiny muted">
            {waterVolume(day?.water ?? 0)} of {waterVolume(targets.water)} — a glass is {GLASS_ML} ml
          </p>
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
        <p className="tiny muted habit-caption">Targets hit, out of seven days</p>
        <div className="habit-grid">
          {(
            [
              { key: 'meals', label: 'Meals' },
              { key: 'protein', label: 'Protein' },
              { key: 'water', label: 'Water' },
              { key: 'movement', label: 'Movement' },
            ] as const
          ).map(({ key, label }) => (
            <div
              key={key}
              className={`habit ${tally[key] >= 5 ? 'is-on' : ''}`}
              aria-label={`${label} target met on ${tally[key]} of 7 days`}
            >
              <span className="tiny">{label}</span>
              <b>{tally[key]}/7</b>
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
