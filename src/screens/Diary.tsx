import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../types';
import type { MealEntry, MealSlot } from '../types';
import { MealThumb } from '../components/MealCard';
import MoreDetail from '../components/MoreDetail';
import { useEssentials, useMoreDetail } from '../components/useDetail';
import CheckinTiles, { type Checkin } from '../components/CheckinTiles';
import CheckinSheets from '../components/CheckinSheets';
import { MacroBars, Micronutrients, MinorNutrients, OverTargetNote, ProgressRing, ScoreMeter } from '../components/charts';
import { Sheet, useToast } from '../components/ui';
import { BasketIcon, BookmarkIcon, CalendarIcon, CameraIcon, PenIcon, PlusIcon, SearchIcon, SparkIcon, TrashIcon } from '../components/icons';
import { findRecipe, recipeFrom } from '../lib/recipes';
import DayDetailSheet, { dayDetailTitle } from '../components/DayDetailSheet';
import CalendarSheet from '../components/diary/CalendarSheet';
import SearchSheet from '../components/diary/SearchSheet';
import DayScoreSheet from '../components/diary/DayScoreSheet';
import MealQuality from '../components/MealQuality';
import { explainDay } from '../lib/dayExplained';
import { useSquish } from '../store/useSquish';
import { addDays, friendlyDate, isoDate, lastDays, weekdayLetter } from '../lib/date';
import { planDays, plansOn, shownNote } from '../lib/planner';
import PlanCard from '../components/PlanCard';
import ShoppingSheet from '../components/ShoppingSheet';
import WeekPlanSheet from '../components/WeekPlanSheet';
import AskLink from '../components/AskLink';
import { dayScore, mealsOn, totalsOn } from '../lib/selectors';
import { loadPhoto } from '../lib/photos';
import { dayVerdict } from '../lib/nutrition';
import './diary.css';
import { describePortion } from '../lib/units';
import { formatEnergy } from '../lib/region';
import { t } from '../lib/i18n';
import { rich } from '../lib/i18n-react';
import { slotWord } from '../lib/words';

/** Each slot's words, whole, so a language never has to lower-case a heading to fit it mid-sentence. */
const SLOTS: { key: MealSlot; label: string; plan: string; addTo: string; snap: string; emoji: string }[] = [
  { key: 'breakfast', label: t('Breakfast'), plan: t('Plan breakfast'), addTo: t('Add to breakfast'), snap: t('Snap breakfast'), emoji: '🌅' },
  { key: 'lunch', label: t('Lunch'), plan: t('Plan lunch'), addTo: t('Add to lunch'), snap: t('Snap lunch'), emoji: '🥗' },
  { key: 'dinner', label: t('Dinner'), plan: t('Plan dinner'), addTo: t('Add to dinner'), snap: t('Snap dinner'), emoji: '🍲' },
  { key: 'snack', label: t('Snacks'), plan: t('Plan a snack'), addTo: t('Add to snacks'), snap: t('Snap a snack'), emoji: '🍎' },
];

export default function Diary({ go, onEditMeal, startDate }: { go: (route: Route) => void; onEditMeal: (meal: MealEntry) => void; startDate?: string }) {
  const toast = useToast();
  const { meals, days, targets, removeMeal, confirmMeal, setWater, setSteps, profile, plans } = useSquish();
  // Just the essentials: the day's calories, protein and meals; scores and the rest a tap away.
  const essentials = useEssentials();
  const more = useMoreDetail();
  const [date, setDate] = useState(startDate ?? isoDate());
  const [selected, setSelected] = useState<MealEntry | null>(null);
  const [picking, setPicking] = useState(false);
  const [searching, setSearching] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [weekPlanning, setWeekPlanning] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  // The strip runs oldest → newest, so bring the chosen day into view.
  useEffect(() => {
    stripRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [date]);

  // The last fortnight, and the week ahead for planning.
  const strip = useMemo(() => [...lastDays(14, isoDate()), ...planDays(isoDate()).slice(1)], []);
  const ahead = date > isoDate();
  const dayPlans = useMemo(() => plansOn(plans, date), [plans, date]);
  const dayMeals = useMemo(() => mealsOn(meals, date), [meals, date]);
  const totals = useMemo(() => totalsOn(meals, date), [meals, date]);
  const day = days[date];
  const score = dayScore(meals, date, targets);
  const verdict = dayVerdict(score, totals, targets);
  const explained = useMemo(() => explainDay(meals, date, targets, isoDate()), [meals, date, targets]);
  const [explaining, setExplaining] = useState(false);
  const [detail, setDetail] = useState(false);
  const [checking, setChecking] = useState<Checkin | null>(null);

  return (
    <div className="screen diary">
      {/* One line: the day is the heading, and the way to any other day — the strip below is only the last fortnight. */}
      <header className="screen-head diary-head">
        <h1 className="diary-title">
          <span className="visually-hidden">{t('Your diary')}: </span>
          <button type="button" className="diary-date" onClick={() => setPicking(true)} aria-label={t('{date} — choose another day', { date: friendlyDate(date) })}>
            <CalendarIcon size={18} /> {friendlyDate(date)}
            {date.slice(0, 4) !== isoDate().slice(0, 4) && ` ${date.slice(0, 4)}`}
          </button>
        </h1>
        <div className="diary-head-actions">
          <button type="button" className="icon-btn" onClick={() => setSearching(true)} aria-label={t('Search your meals')}>
            <SearchIcon size={18} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setShopping(true)} aria-label={t('Shopping list')}>
            <BasketIcon size={18} />
          </button>
          {/* Logging is the + at the bottom, and a day's own buttons; this is the way to the week's plan, which was otherwise only on Home. */}
          <button type="button" className="btn btn--sm" onClick={() => go({ name: 'ask', tab: 'plan', back: { name: 'meals', date } })}>
            <CalendarIcon size={16} /> {t('Meal plan')}
          </button>
        </div>
      </header>

      <ShoppingSheet open={shopping} onClose={() => setShopping(false)} from={date} />
      <WeekPlanSheet open={weekPlanning} onClose={() => setWeekPlanning(false)} />
      <CalendarSheet key={`${date}-${picking}`} open={picking} date={date} onClose={() => setPicking(false)} onPick={setDate} />
      <SearchSheet
        open={searching}
        onClose={() => setSearching(false)}
        onPick={(meal) => {
          setDate(meal.date);
          setSelected(meal);
        }}
      />

      <div className="date-strip" role="tablist" aria-label={t('Choose a day')} ref={stripRef}>
        {strip.map((d) => {
          const logged = mealsOn(meals, d).length > 0;
          const planned = d > isoDate() && plansOn(plans, d).length > 0;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === date}
              className={`date-pill ${d === date ? 'is-on' : ''}${d > isoDate() ? ' date-pill--ahead' : ''}`}
              onClick={() => setDate(d)}
            >
              <span className="tiny">{weekdayLetter(d)}</span>
              <b>{Number(d.slice(-2))}</b>
              <span className={`date-dot ${logged ? 'is-on' : ''}${planned ? ' is-planned' : ''}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {ahead ? (
        <section className="card card--quiet diary-ahead">
          <p className="small">
            {rich('<b>Planning {day}.</b> Add meals you mean to have. They count for nothing until you tap “I ate this” on the day.', {
              day: date === addDays(isoDate(), 1) ? friendlyDate(date).toLocaleLowerCase() : friendlyDate(date),
            }, { b: (text) => <b>{text}</b> })}
          </p>
          {dayPlans.length > 0 && (
            <p className="tiny muted">
              {t('{n} planned · about {energy} of your {target}', {
                n: dayPlans.length,
                energy: formatEnergy(dayPlans.reduce((sum, p) => sum + p.nutrients.calories, 0)),
                target: formatEnergy(targets.calories),
              })}
            </p>
          )}
          <div className="row diary-ahead-links">
            <button type="button" className="btn--quiet small row" onClick={() => setWeekPlanning(true)}>
              <SparkIcon size={15} /> {t('Plan my week with Squish')}
            </button>
            {dayPlans.length > 0 && (
              <button type="button" className="btn--quiet small row" onClick={() => setShopping(true)}>
                <BasketIcon size={15} /> {t('Shopping list')}
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="card diary-summary">
          <div className="row diary-summary-row">
            {/* Food quality under the ring, where there is room, rather than a row of its own above the bars. */}
            <div className="diary-ring">
              <ProgressRing value={totals.calories} target={targets.calories} size={120} />
              {more.full && <div className="diary-verdict">
                <span className="tiny muted">{t('Food quality')}</span>
                {score > 0 ? (
                  // Tappable: what the score is and what moved it. Today, until
                  // there is enough logged, it says so rather than judging.
                  <button type="button" className="diary-score-btn" onClick={() => setExplaining(true)} aria-label={t('What is food quality?')}>
                    <span className={`badge badge--${explained.early ? 'none' : verdict.tone}`}>
                      {explained.early ? t('Early days') : verdict.tone === 'none' ? verdict.label : `${score} ${verdict.label}`}
                    </span>
                    <span className="why" aria-hidden="true">ⓘ</span>
                  </button>
                ) : (
                  <span className="badge">{t('Nothing logged')}</span>
                )}
              </div>}
            </div>
            <div className="grow diary-bars">
              <MacroBars totals={totals} targets={targets} compact only={more.full ? undefined : ['protein']} />
              {/* Sugar, salt and the vitamins, a tap away, so the day fits on one screen. */}
              {more.full && totals.calories > 0 && (
                <button type="button" className="more-link tiny" onClick={() => setDetail(true)}>
                  {dayDetailTitle()} ›
                </button>
              )}
              {more.toggle}
            </div>
          </div>
          {more.full && <OverTargetNote over={verdict.over} />}
          <CheckinTiles
            water={day?.water ?? 0}
            waterTarget={targets.water}
            steps={day?.steps ?? 0}
            weightKg={day?.weightKg}
            units={profile.units}
            stepsAdd={500}
            onWater={(glasses) => setWater(date, glasses)}
            onSteps={(steps) => setSteps(date, steps)}
            onOpen={setChecking}
            only={more.full ? undefined : ['water']}
          />
        </section>
      )}

      <DayScoreSheet
        open={explaining}
        onClose={() => setExplaining(false)}
        explained={explained}
        question={date === isoDate() ? t('What would make today’s food better?') : t('What would have made {day} better?', { day: friendlyDate(date) })}
        onAsk={(question) => go({ name: 'ask', question })}
      />


      {/* All four slots in one card, a row per meal, so the day fits on one screen. */}
      <section className="card diary-meals">
        {SLOTS.map(({ key, label, plan, addTo, snap, emoji }) => {
          const list = dayMeals.filter((m) => m.slot === key);
          const planned = dayPlans.filter((p) => p.slot === key);
          const kcal = Math.round(list.reduce((sum, m) => sum + m.nutrients.calories, 0));
          return (
            <div className="diary-slot" key={key}>
              <div className="diary-slot-head">
                <h3 className="diary-slot-name">
                  <span aria-hidden="true">{emoji}</span> {label}
                </h3>
                <span className="tiny muted">{ahead ? (planned.length ? t('planned') : '') : list.length ? formatEnergy(kcal) : t('Nothing yet')}</span>
                {!ahead && (
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={snap} onClick={() => go({ name: 'capture', slot: key, date })}>
                    <CameraIcon size={15} />
                  </button>
                )}
                <button type="button" className="icon-btn icon-btn--sm" aria-label={ahead ? plan : addTo} onClick={() => go({ name: 'add', slot: key, date, tab: 'search' })}>
                  <PlusIcon size={15} />
                </button>
              </div>
              {planned.length > 0 && (
                <div className="stack diary-plans">
                  {planned.map((p) => (
                    <PlanCard key={p.id} plan={p} />
                  ))}
                </div>
              )}
              {list.map((meal) => (
                <button type="button" className="diary-meal" key={meal.id} onClick={() => setSelected(meal)}>
                  <MealThumb meal={meal} className="diary-meal-thumb" />
                  <span className="diary-meal-text">
                    <span className="diary-meal-title" dir="auto">{meal.title}</span>
                    <span className="tiny muted">
                      {meal.time} · {formatEnergy(meal.nutrients.calories)}
                      {meal.quick && <span className="badge diary-meal-check">{t('to check')}</span>}
                    </span>
                  </span>
                  {!essentials && <span className="diary-meal-score">{meal.score}</span>}
                </button>
              ))}
            </div>
          );
        })}
      </section>

      <DayDetailSheet open={detail} onClose={() => setDetail(false)} date={date} totals={totals} targets={targets} />

      <CheckinSheets date={date} open={checking} onClose={() => setChecking(null)} />

      <Sheet open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title}>
        {selected && (
          <div className="stack">
            {selected.photo && <MealPhoto meal={selected} />}
            <div className="row" style={{ gap: 12 }}>
              {!essentials && <ScoreMeter score={selected.score} size={54} />}
              <div>
                <b style={{ fontSize: 24 }}>{formatEnergy(selected.nutrients.calories)}</b>
                <p className="tiny muted">
                  {selected.time} · {slotWord(selected.slot)} · {selected.source === 'photo' ? t('photo analysis') : t('logged by hand')}
                </p>
              </div>
            </div>

            {selected.quick && (
              <div className="card card--tint card--flat diary-quick">
                <p className="small">{t('Logged from a quick snap, so nobody has checked it yet. Does it look right?')}</p>
                <div className="row" style={{ gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost grow"
                    onClick={() => {
                      const meal = selected;
                      setSelected(null);
                      onEditMeal(meal);
                    }}
                  >
                    {t('Change it')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm grow"
                    onClick={() => {
                      confirmMeal(selected.id);
                      setSelected({ ...selected, quick: undefined });
                    }}
                  >
                    {t('Looks right')}
                  </button>
                </div>
              </div>
            )}

            <MoreDetail>
            <MealQuality meal={selected} />
            <AskLink
              question={t('How could I make my {meal} even better?', { meal: selected.title.trim().toLocaleLowerCase() })}
              onAsk={(question) => {
                setSelected(null);
                go({ name: 'ask', question });
              }}
            />

            <MacroBars totals={selected.nutrients} targets={targets} compact />
            <MinorNutrients totals={selected.nutrients} targets={targets} />
            <Micronutrients totals={selected.nutrients} targets={targets} meal />
            </MoreDetail>

            <div className="card card--tint card--flat">
              {selected.items.map((item) => (
                <div className="list-row" key={item.id}>
                  <span className="thumb thumb--emoji" aria-hidden="true">{item.emoji ?? '🍽️'}</span>
                  <span className="grow">
                    <b className="small">{item.name}</b>
                    <p className="tiny muted">{describePortion(item.portion, item.grams, item.liquid)}</p>
                  </span>
                  <span className="small">{formatEnergy(item.nutrients.calories)}</span>
                </div>
              ))}
            </div>

            {selected.coachNote && <p className="speech" dir="auto">{selected.coachNote}</p>}

            <SaveRecipeButton meal={selected} />
            {selected.note && <p className="small muted">"{t(shownNote(selected.note))}"</p>}

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
                <PenIcon size={17} /> {t('Edit')}
              </button>
              <button
                type="button"
                className="btn btn--danger grow"
                onClick={() => {
                  removeMeal(selected.id);
                  setSelected(null);
                  toast(t('Meal removed'), '🗑️');
                }}
              >
                <TrashIcon size={17} /> {t('Delete')}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/**
 * The photograph of a meal, with its thumbnail standing in until it arrives.
 *
 * The full-size one is in IndexedDB and reading it is asynchronous, so the
 * thumbnail — already in hand, a few kilobytes — is shown first and swapped
 * when the real one loads. Nobody sees an empty box, and a device that cannot
 * produce the photograph at all simply keeps showing the thumbnail rather
 * than an error nobody can act on.
 */
function MealPhoto({ meal }: { meal: MealEntry }) {
  const [full, setFull] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setFull(null);
    void loadPhoto(meal.id).then((found) => {
      if (live) setFull(found);
    });
    return () => {
      live = false;
    };
  }, [meal.id]);

  return <img src={full ?? meal.photo} alt="" className="review-photo" />;
}

/** "That was good": the meal as they had it, into the recipe box to plan again. Tapped again, it comes out. */
function SaveRecipeButton({ meal }: { meal: MealEntry }) {
  const { recipes, saveRecipe, removeRecipe } = useSquish();
  const toast = useToast();
  const saved = findRecipe(recipes, meal.title);
  return (
    <button
      type="button"
      className="btn--quiet small row diary-save-recipe"
      aria-pressed={Boolean(saved)}
      onClick={() => {
        if (saved) {
          removeRecipe(saved.id);
          toast(t('Taken out of your recipes.'), '📕');
        } else {
          saveRecipe(recipeFrom(meal, isoDate()));
          toast(t('Saved to your recipes — plan it again from the meal plan.'), '📖');
        }
      }}
    >
      <BookmarkIcon size={16} filled={Boolean(saved)} /> {saved ? t('In your recipes') : t('Save to my recipes')}
    </button>
  );
}
