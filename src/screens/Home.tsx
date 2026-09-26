import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import TodayPlanning from '../components/TodayPlanning';
import PlanCard from '../components/PlanCard';
import ShoppingSheet from '../components/ShoppingSheet';
import { plansOn } from '../lib/planner';
import NutritionistCard from '../components/NutritionistCard';
import type { Route } from '../types';
import Squish from '../components/Squish';
import EmptyState from '../components/EmptyState';
import MealCard from '../components/MealCard';
import { MacroBars, MacroSplitBar, MinorNutrients, OverTargetNote, ProgressRing, StreakDots } from '../components/charts';
import { BasketIcon, CameraIcon, ChevronIcon, DropIcon, HeartIcon, PenIcon, SearchIcon, ShoeIcon, FlameIcon } from '../components/icons';
import { WeightField } from '../components/fields';
import { Sheet } from '../components/ui';
import { formatWeight, saltLabel } from '../lib/units';
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
import { useCheerInbox, useSquad } from '../components/squad/useSquad';
import './home.css';
import { energyValue, formatEnergy } from '../lib/region';
import { plural, t } from '../lib/i18n';

export default function Home({ go }: { go: (route: Route) => void }) {
  const today = isoDate();
  const { profile, targets, meals, days, setWater, setSteps, setWeight, lastCoachNote, rememberCoachNote, pendingMeal, setPendingMeal } =
    useSquish();
  const [weighing, setWeighing] = useState(false);
  const [shopping, setShopping] = useState(false);
  const inbox = useCheerInbox();
  const squad = useSquad();
  const cheered = inbox.length > 0 && squad.kind === 'in';
  const chosenScene = useSquish((s) => s.scene);
  const unlocked = useSquish((s) => s.unlocked);
  const subscribed = useSubscribed();
  const scene = sceneInUse(chosenScene, { unlocked, subscribed, today: new Date() });
  const day = days[today];

  const totals = useMemo(() => totalsOn(meals, today), [meals, today]);
  const todaysMeals = useMemo(() => mealsOn(meals, today), [meals, today]);
  const plans = useSquish((s) => s.plans);
  const plannedToday = useMemo(() => plansOn(plans, today), [plans, today]);
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
    ? t('{energy} left today — and {grams} g of protein to go.', { energy: formatEnergy(remaining(targets.calories, totals.calories)), grams: remaining(targets.protein, totals.protein) })
    // Asked as an opening rather than a reproach: "nothing squished yet" is a
    // blank page, and "you haven't squished anything" is a telling-off.
    : part === 'night'
      ? // Late on, "what's first?" reads as an invitation to eat. The day can simply end.
        t('Nothing squished today — that’s fine. Tomorrow is a fresh page.')
      : t('Nothing squished yet — what’s first?');

  return (
    <div className="screen home">
      <header className="home-top">
        <div>
          <p className="tiny muted">{greeting()}</p>
          <h1>{profile.name ? t('Hi {name}', { name: profile.name }) : t('Hello there')}</h1>
        </div>
        <div className="home-streak" title={t('Logging streak')}>
          <FlameIcon size={18} />
          <b>{streak}</b>
          <span className="tiny">{plural(streak, { one: 'day', other: 'days' })}</span>
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
          <p className="speech speech--right" dir="auto">{nudge ?? fallbackNudge}</p>
          <p className="script home-mood">{statusLine(situation)}</p>
        </div>
        <Squish mood={mood} size={132} />
      </section>

      {/* A cheer from the squad brings it up here until it has been seen; the
          rest of the time the squad sits lower down, with the other social bits. */}
      {cheered && <SquadStrip onOpenYou={() => go({ name: 'you' })} />}


      {/* A meal that was analysed and never saved. It is offered back rather
          than logged: nobody asked for it to go in the diary, and a tracker
          that logs food you did not confirm is a tracker you stop trusting. */}
      {pendingMeal && (
        <section className="card home-pending">
          <div className="card-title">
            <h3>{t('Unfinished meal')}</h3>
            <span className="badge badge--warn">{t('Not saved')}</span>
          </div>
          <p className="small">
            <b>{pendingMeal.analysis.title}</b> — {formatEnergy(pendingMeal.analysis.nutrients.calories)},{' '}
            {friendlyDate(pendingMeal.date).toLocaleLowerCase()}.
          </p>
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button type="button" className="btn btn--sm grow" onClick={() => go({ name: 'review', draft: pendingMeal })}>
              {t('Finish it')}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPendingMeal(null)}>
              {t('Throw it away')}
            </button>
          </div>
        </section>
      )}

      <section className="card card--hero home-today">
        <div className="card-title">
          <h3>{t('Today')}</h3>
          <span className="badge">{plural(todaysMeals.length, { one: '{n} meal', other: '{n} meals' })}</span>
        </div>

        {/* Ring and macros side by side, as in the diary, so the whole card and
            the buttons to log with fit on the first screen of a phone. The
            macro bars carry protein and fibre with their numbers — the stat
            pills that used to sit beside the ring said it twice. */}
        <div className="home-today-row">
          <div className="home-ring-wrap">
            <ProgressRing value={totals.calories} target={targets.calories} size={140} />
            <p className="tiny muted home-ring-caption">
              {t('{eaten} of {target}', { eaten: energyValue(totals.calories), target: formatEnergy(targets.calories) })}
            </p>
          </div>
          <div className="home-today-bars">
            <MacroBars totals={totals} targets={targets} compact />
          </div>
        </div>
        {/* Anything over a limit is said up front; the rest of the detail is a
            tap away, so the ring and the buttons to log with share a screen. */}
        <OverTargetNote over={overTargets(totals, targets)} />
        {totals.calories > 0 && (
          <details className="home-more">
            <summary className="small">{t('Sugar, {salt} and more', { salt: saltLabel().toLocaleLowerCase() })}</summary>
            {dayComparison && (
              <Comparison
                equivalent={dayComparison.equivalent}
                variant="day"
                tail={progressWords(totals[dayComparison.equivalent.nutrient], targets[dayComparison.equivalent.nutrient])}
              />
            )}
            <MinorNutrients totals={totals} targets={targets} />
            <div className="divider" />
            <MacroSplitBar totals={totals} />
          </details>
        )}
      </section>

      <section className="home-actions">
        <button type="button" className="action action--primary" onClick={() => go({ name: 'capture' })}>
          <CameraIcon size={22} />
          {t('Snap a meal')}
        </button>
        <div className="home-actions-row">
          <button type="button" className="action" onClick={() => go({ name: 'add', tab: 'describe' })}>
            <PenIcon size={20} />
            {t('Describe')}
          </button>
          <button type="button" className="action" onClick={() => go({ name: 'add', tab: 'search' })}>
            <SearchIcon size={20} />
            {t('Search')}
          </button>
          <button type="button" className="action" onClick={() => go({ name: 'add', tab: 'favourites' })}>
            <HeartIcon size={20} />
            {t('Saved')}
          </button>
        </div>
      </section>

      <NutritionistCard go={go} />

      {/* What has been eaten today, and what is still planned for later —
          together, and right under the numbers they add up to. */}
      <section className="card home-meals">
        <div className="card-title">
          <h3>{t("Today's meals")}</h3>
          <button type="button" className="btn--quiet small" onClick={() => go({ name: 'meals' })}>
            {t('See all')}
          </button>
        </div>
        {todaysMeals.length === 0 && plannedToday.length === 0 ? (
          <EmptyState
            mood="calm"
            action={
              <button type="button" className="btn btn--soft btn--sm" onClick={() => go({ name: 'capture' })}>
                {t('Snap your first meal')}
              </button>
            }
          >
            {t("Nothing logged yet today — snap a meal and I'll do the maths.")}
          </EmptyState>
        ) : (
          <div className="stack">
            {todaysMeals.slice().reverse().map((meal) => (
              <MealCard key={meal.id} meal={meal} onClick={() => go({ name: 'meals' })} />
            ))}
            {plannedToday.length > 0 && (
              <>
                <div className="row-between home-planned-head">
                  <span className="tiny muted">{t('Still planned for today')}</span>
                  <button type="button" className="btn--quiet small row" onClick={() => setShopping(true)}>
                    <BasketIcon size={15} /> {t('Shopping list')}
                  </button>
                </div>
                {plannedToday.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} showSlot />
                ))}
              </>
            )}
          </div>
        )}
      </section>
      <TodayPlanning go={go} />





      <p className="section-label">{t('Daily check-ins')}</p>

      <section className="home-trackers">
        <div className="card card--quiet tracker">
          <div className="row-between">
            <span className="row tiny muted" style={{ gap: 6 }}>
              <DropIcon size={16} /> {t('Water')}
            </span>
            <b className="small">{t('{done}/{target} glasses', { done: day?.water ?? 0, target: targets.water })}</b>
          </div>
          <div className="glasses">
            {Array.from({ length: targets.water }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`glass ${i < (day?.water ?? 0) ? 'is-full' : ''}`}
                aria-label={plural(i + 1, { one: '{n} glass of water', other: '{n} glasses of water' })}
                onClick={() => setWater(today, i + 1 === (day?.water ?? 0) ? i : i + 1)}
              />
            ))}
          </div>
          <p className="tiny muted">
            {t('{drunk} of {target} — a glass is {ml} ml', { drunk: waterVolume(day?.water ?? 0), target: waterVolume(targets.water), ml: GLASS_ML })}
          </p>
        </div>

        <div className="card card--quiet tracker">
          <div className="row-between">
            <span className="row tiny muted" style={{ gap: 6 }}>
              <ShoeIcon size={16} /> {t('Movement')}
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
                aria-label={t('Add {n} steps', { n: add })}
                onClick={() => setSteps(today, (day?.steps ?? 0) + add)}
              >
                +{add >= 1000 ? `${add / 1000}k` : add}
              </button>
            ))}
            {(day?.steps ?? 0) > 0 && (
              <button type="button" className="chip" onClick={() => setSteps(today, 0)}>
                {t('Clear')}
              </button>
            )}
          </div>
        </div>
      </section>

      <button type="button" className="card card--quiet weigh-row" onClick={() => setWeighing(true)}>
        <span className="row" style={{ gap: 8 }}>
          <span aria-hidden="true">⚖️</span>
          <span className="small">{t('Weight')}</span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <b className="small">{day?.weightKg ? formatWeight(day.weightKg, profile.units) : t('Tap to log')}</b>
          <ChevronIcon size={16} />
        </span>
      </button>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>{t('This week')}</h3>
          <span className="tiny muted">{t('{n}/7 days logged', { n: loggedThisWeek.filter(Boolean).length })}</span>
        </div>
        <StreakDots dates={week} done={loggedThisWeek} />
        <div className="divider" />
        <p className="tiny muted habit-caption">{t('Targets hit, out of seven days')}</p>
        <div className="habit-grid">
          {(
            [
              { key: 'meals', label: t('Meals') },
              { key: 'protein', label: t('Protein') },
              { key: 'water', label: t('Water') },
              { key: 'movement', label: t('Movement') },
            ] as const
          ).map(({ key, label }) => (
            <div
              key={key}
              className={`habit ${tally[key] >= 5 ? 'is-on' : ''}`}
              aria-label={t('{habit} target met on {n} of 7 days', { habit: label, n: tally[key] })}
            >
              <span className="tiny">{label}</span>
              <b>{tally[key]}/7</b>
            </div>
          ))}
        </div>
      </section>


      <FriendNudge onOpenYou={() => go({ name: 'you' })} />
      {!cheered && <SquadStrip onOpenYou={() => go({ name: 'you' })} />}

      <p className="script home-footer">{t('Good food. Brighter days. ♡')}</p>

      <ShoppingSheet open={shopping} onClose={() => setShopping(false)} />

      <Sheet open={weighing} onClose={() => setWeighing(false)} title={t("Today's weight")}>
        <div className="stack">
          <WeightField
            label={t('Weight')}
            kg={day?.weightKg ?? profile.weightKg}
            units={profile.units}
            onChange={(kg) => setWeight(today, kg)}
          />
          <p className="tiny muted">
            {lastWeighIn
              ? t('Last logged {weight} on {date}.', { weight: formatWeight(lastWeighIn.weightKg, profile.units), date: friendlyDate(lastWeighIn.date) })
              : t('Weigh yourself at the same time of day — first thing is the steadiest.')}
          </p>
          <button type="button" className="btn btn--block" onClick={() => setWeighing(false)}>
            {t('Done')}
          </button>
        </div>
      </Sheet>

    </div>
  );
}
