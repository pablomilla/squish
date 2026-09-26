import { useEffect, useMemo, useState } from 'react';
import Squish from '../components/Squish';
import { MacroSplitBar, StreakDots, WeeklyBars, WeightTrend } from '../components/charts';
import { Segmented } from '../components/ui';
import ShareSheet from '../components/ShareSheet';
import { shareStory } from '../lib/shareStory';
import type { ShareCardData } from '../lib/share';
import { FlameIcon, ShareIcon } from '../components/icons';
import { useSquish } from '../store/useSquish';
import AskLink from '../components/AskLink';
import type { Route } from '../types';
import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS } from '../lib/achievements';
import { unlocksLine } from '../lib/rewards';
import { daysBetween, isoDate, lastDays, shortDate, weekOf } from '../lib/date';
import { bestStreak, habitCount, habitsOn, mealsOn, series, streakForgaveADay, streakOf, summarise, totalsOn, weightSeries } from '../lib/selectors';
import { MACRO_LABEL, OVER, addOptional, ceilingLimit, isCeiling, round1 } from '../lib/nutrition';
import { formatWeight, formatWeightDelta, saltGrams, saltLabel, saltShown, saltShownFromSalt, saltUnit } from '../lib/units';
import { currentEnergyUnit, energyValue, fibreWord, formatEnergy } from '../lib/region';
import type { MacroKey } from '../types';
import { progressBars, type Range } from '../lib/progressBars';
import './insights.css';
import { plural, t, uiLanguage } from '../lib/i18n';

type Metric = 'calories' | 'protein' | 'carbs' | 'fat' | 'fibre' | 'sugar' | 'salt' | 'score';

/** Functions of the region: kJ or kcal, salt in grams or sodium in milligrams, fibre or fiber. */
const metricUnit = (m: Metric): string =>
  ({ calories: currentEnergyUnit(), protein: 'g', carbs: 'g', fat: 'g', fibre: 'g', sugar: 'g', salt: saltUnit(), score: t('pts') })[m];
const metricLabel = (m: Metric): string =>
  ({
    calories: currentEnergyUnit() === 'kJ' ? t('Energy') : t('Calories'),
    protein: t('Protein'),
    carbs: t('Carbs'),
    fat: t('Fat'),
    fibre: fibreWord(),
    sugar: t('Sugar'),
    salt: saltLabel(),
    score: t('Quality'),
  })[m];
/** Mid-sentence: lower case in English, as written in languages (German) where nouns keep their capital. */
const inSentence = (words: string) => (uiLanguage() === 'en' ? words.toLowerCase() : words);
/** A figure as the charts hold it (kcal, grams of salt), in the unit shown. */
const shown = (m: Metric, value: number): number =>
  m === 'calories' ? energyValue(value) : m === 'salt' ? saltShownFromSalt(value) : value;
/** The ones you are trying to stay under rather than reach. */
const METRIC_CEILING: Metric[] = ['sugar', 'salt'];

export default function Insights({ go }: { go?: (route: Route) => void }) {
  const [sharing, setSharing] = useState(false);
  const { meals, days, targets, unlocked, profile, unlock } = useSquish();
  const [range, setRange] = useState<Range>('7');
  const [metric, setMetric] = useState<Metric>('calories');
  const today = isoDate();

  const dates = useMemo(() => {
    if (range === '7') return lastDays(7, today);
    if (range === '30') return lastDays(30, today);
    // All of it, from the first meal ever logged — not a quiet four months.
    const first = meals.map((m) => m.date).sort()[0];
    const span = first ? Math.max(7, daysBetween(first, today) + 1) : 7;
    return lastDays(span, today);
  }, [range, meals, today]);

  const points = useMemo(() => series(meals, dates, targets), [meals, dates, targets]);
  const summary = useMemo(() => summarise(points, targets), [points, targets]);
  const chart = useMemo(() => progressBars(points, range), [points, range]);
  const shownBars = useMemo(
    () => (metric === 'calories' || metric === 'salt' ? chart.bars.map((bar) => ({ ...bar, [metric]: shown(metric, bar[metric]) })) : chart.bars),
    [chart.bars, metric],
  );
  const week = weekOf(today);
  const loggedThisWeek = week.map((d) => mealsOn(meals, d).length > 0);
  const streak = streakOf(meals, today);
  const forgave = streakForgaveADay(meals, today);
  const best = bestStreak(meals);
  const weights = useMemo(() => weightSeries(days, 120), [days]);

  // Held steady, because the share sheet redraws the card whenever this changes.
  const shareData = useMemo<ShareCardData>(
    () => shareStory({ streak, best, mealCount: meals.length, summary }),
    [streak, best, summary, meals.length],
  );
  const weekTotals = useMemo(
    () => dates.reduce(
      (acc, d) => {
        const t = totalsOn(meals, d);
        return {
          calories: acc.calories + t.calories,
          protein: acc.protein + t.protein,
          carbs: acc.carbs + t.carbs,
          fat: acc.fat + t.fat,
          fibre: acc.fibre + t.fibre,
          satFat: addOptional(acc.satFat, t.satFat),
          sugar: acc.sugar + (t.sugar ?? 0),
          freeSugar: addOptional(acc.freeSugar, t.freeSugar),
          sodium: acc.sodium + (t.sodium ?? 0),
        };
      },
      {
        calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0, sodium: 0,
        satFat: undefined as number | undefined,
        freeSugar: undefined as number | undefined,
      },
    ),
    [dates, meals],
  );

  const habitTotals = useMemo(
    () => dates.map((d) => habitCount(habitsOn(meals, days, targets, d))),
    [dates, meals, days, targets],
  );
  const habitScore = habitTotals.length
    ? Math.round((habitTotals.reduce((a, b) => a + b, 0) / (habitTotals.length * 4)) * 100)
    : 0;


  useEffect(() => {
    if (summary.avgScore >= 75) unlock('balanced-day');
  }, [summary.avgScore, unlock]);

  const topFoods = useMemo(() => {
    const counts = new Map<string, { name: string; emoji?: string; count: number; kcal: number }>();
    for (const meal of meals.filter((m) => dates.includes(m.date))) {
      for (const item of meal.items) {
        const key = item.name.toLowerCase();
        const prev = counts.get(key);
        counts.set(key, {
          name: item.name,
          emoji: item.emoji,
          count: (prev?.count ?? 0) + 1,
          kcal: (prev?.kcal ?? 0) + item.nutrients.calories,
        });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  }, [meals, dates]);

  // Six metrics is more than a chain of ternaries wants to carry.
  const metricAverage: number = {
    calories: summary.avgCalories,
    protein: summary.avgProtein,
    carbs: summary.avgCarbs,
    fat: summary.avgFat,
    fibre: summary.avgFibre,
    sugar: summary.avgSugar,
    salt: summary.avgSalt,
    score: summary.avgScore,
  }[metric];

  const metricTarget: number = {
    calories: targets.calories,
    protein: targets.protein,
    carbs: targets.carbs,
    fat: targets.fat,
    fibre: targets.fibre,
    sugar: targets.sugar ?? 0,
    salt: saltGrams(targets.sodium ?? 0),
    score: 75,
    // Held in kcal and salt grams like the bars; converted with them below.
  }[metric];

  const macroAverages = useMemo(() => {
    const logged = points.filter((p) => p.logged).length || 1;
    return (['protein', 'carbs', 'fat', 'fibre'] as MacroKey[]).map((key) => ({
      key,
      avg: Math.round(weekTotals[key] / logged),
      target: targets[key],
    }));
  }, [points, weekTotals, targets]);

  /* Sugar and salt sit apart from the macros rather than in the same grid:
     "on target" means the opposite thing for a limit, and putting them in one
     row of four would have said it backwards. */
  const ceilingAverages = useMemo(() => {
    const logged = points.filter((p) => p.logged).length || 1;
    return [
      ...(weekTotals.satFat === undefined
        ? []
        : [{ key: 'satFat', label: t('Saturates'), avg: round1(weekTotals.satFat / logged), limit: Math.round(targets.satFat ?? 0) }]),
      ...(weekTotals.freeSugar === undefined
        ? []
        : [{ key: 'freeSugar', label: t('Free sugars'), avg: round1(weekTotals.freeSugar / logged), limit: Math.round(targets.freeSugar ?? 0) }]),
      { key: 'sugar', label: t('Sugar'), avg: Math.round(weekTotals.sugar / logged), limit: ceilingLimit('sugar', targets) },
      { key: 'salt', label: saltLabel(), avg: saltShown(weekTotals.sodium / logged), limit: saltShown(targets.sodium ?? 0) },
    ].filter((row) => row.limit > 0);
  }, [points, weekTotals, targets]);

  return (
    <div className="screen insights">
      <header className="screen-head">
        <div>
          <h1>{t('Your progress')}</h1>
          <p>{t('{logged} of {days} days logged', { logged: summary.loggedDays, days: summary.days })}</p>
        </div>
        <div className="home-streak">
          <FlameIcon size={18} />
          <b>{streak}</b>
        </div>
      </header>

      <Segmented<Range>
        label={t('Range')}
        value={range}
        onChange={setRange}
        options={[
          { value: '7', label: t('Weekly') },
          { value: '30', label: t('Monthly') },
          { value: 'all', label: t('All time') },
        ]}
      />

      <section className="card">
        <div className="insights-streak">
          <Squish mood={streak >= 3 ? 'cheering' : 'calm'} size={92} />
          <div>
            <p className="speech">
              {streak >= 3
                ? t("You're on a {n} day streak! Keep it going 💜", { n: streak })
                : t('Log something today and we start a new streak together.')}
            </p>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              {plural(best, { one: 'Best streak: {n} day', other: 'Best streak: {n} days' })}
            </p>
            {forgave && (
              <p className="tiny" style={{ marginTop: 4, color: 'var(--brand-ink)' }}>
                {t('You missed a day and came back — the streak held. It takes two in a row to lose it.')}
              </p>
            )}
          </div>
        </div>
        {/* Always here, so the share card — and its frames and stickers — can
            be found before there is a streak to put on it. */}
        <button type="button" className="btn btn--soft btn--block share-trigger" onClick={() => setSharing(true)}>
          <ShareIcon size={18} /> {streak >= 2 ? t('Share my streak') : t('Share a card')}
        </button>
        <div className="divider" />
        <StreakDots dates={week} done={loggedThisWeek} />
      </section>

      {go && (
        <AskLink
          label={t('Ask the nutritionist about your week')}
          question={t('How was my week, and what’s the one thing to change?')}
          onAsk={(question) => go({ name: 'ask', question })}
        />
      )}

      <section className="card">
        <div className="card-title">
          <h3>
            {chart.grain === 'day'
              ? t('Daily {metric}', { metric: inSentence(metricLabel(metric)) })
              : chart.grain === 'week'
                ? t('Weekly average {metric}', { metric: inSentence(metricLabel(metric)) })
                : t('Monthly average {metric}', { metric: inSentence(metricLabel(metric)) })}
          </h3>
          <span className="tiny muted">{t('avg {value} {unit}', { value: shown(metric, metricAverage), unit: metricUnit(metric) })}</span>
        </div>
        <WeeklyBars
          key={range}
          points={shownBars}
          target={shown(metric, metricTarget)}
          metric={metric}
          unit={metricUnit(metric)}
          ceiling={METRIC_CEILING.includes(metric)}
        />
        <div className="metric-row">
          {(['calories', 'protein', 'carbs', 'fat', 'fibre', 'sugar', 'salt', 'score'] as Metric[]).map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {metricLabel(m)}
            </button>
          ))}
        </div>
      </section>

      <section className="insights-stats">
        <div className="pill-stat">
          <span className="tiny muted">{t('Avg energy')}</span>
          <b>{formatEnergy(summary.avgCalories)}</b>
        </div>
        <div className="pill-stat">
          <span className="tiny muted">{t('On-target days')}</span>
          <b>{summary.onTargetDays}</b>
        </div>
        <div className="pill-stat">
          <span className="tiny muted">{t('Avg quality')}</span>
          <b>{summary.avgScore}/100</b>
        </div>
        <div className="pill-stat">
          <span className="tiny muted">{t('Habit rate')}</span>
          <b>{habitScore}%</b>
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h3>{t('Average day')}</h3>
          <span className="tiny muted">{t('per logged day')}</span>
        </div>
        <MacroSplitBar totals={{ calories: weekTotals.calories, protein: weekTotals.protein, carbs: weekTotals.carbs, fat: weekTotals.fat, fibre: weekTotals.fibre }} />
        <div className="divider" />
        <div className="avg-grid">
          {macroAverages.map(({ key, avg, target }) => {
            const share = target > 0 ? avg / target : 0;
            // Fat and carbs sailing past their target used to read "on target"
            // too, which is the same blind spot the day score had — but the
            // line to cross is their limit, not their aim.
            const limit = isCeiling(key) ? ceilingLimit(key, targets) : 0;
            const over = limit > 0 && avg > limit * OVER;
            const on = !over && share >= 0.9;
            return (
              <div key={key} className="avg-cell">
                <span className="tiny muted">{MACRO_LABEL[key]}</span>
                <b>{avg} g</b>
                <span
                  className={`tiny ${on ? 'avg-on' : over ? 'avg-over' : 'avg-off'}`}
                  aria-label={t('{percent} per cent of the {nutrient} goal', { percent: Math.round(share * 100), nutrient: MACRO_LABEL[key] })}
                >
                  {over ? t('over {n} g', { n: limit }) : on ? t('on target') : `${Math.round(share * 100)}%`}
                </span>
              </div>
            );
          })}
        </div>
        {ceilingAverages.length > 0 && (
          <>
            <div className="divider" />
            <div className="avg-grid" style={{ gridTemplateColumns: `repeat(${ceilingAverages.length === 4 ? 2 : ceilingAverages.length}, minmax(0, 1fr))` }}>
              {ceilingAverages.map(({ key, label, avg, limit }) => {
                const under = avg <= limit;
                const unit = key === 'salt' ? saltUnit() : 'g';
                return (
                  <div key={key} className="avg-cell">
                    <span className="tiny muted">{label}</span>
                    <b>
                      {avg.toLocaleString()} {unit}
                    </b>
                    <span
                      className={`tiny ${under ? 'avg-on' : 'avg-over'}`}
                      aria-label={under ? t('under the {limit} {unit} daily limit', { limit, unit }) : t('over the {limit} {unit} daily limit', { limit, unit })}
                    >
                      {under ? t('under {limit} {unit}', { limit, unit }) : t('over {limit} {unit}', { limit, unit })}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          <h3>{t('Weight')}</h3>
          <span className="tiny muted">{t('goal {weight}', { weight: formatWeight(profile.targetWeightKg, profile.units) })}</span>
        </div>
        <WeightTrend points={weights} goalKg={profile.targetWeightKg} units={profile.units} />
        {weights.length >= 2 && (
          <p className="tiny muted" style={{ marginTop: 6 }}>
            {t('{change} since {date}', {
              change: formatWeightDelta(weights[weights.length - 1].weightKg - weights[0].weightKg, profile.units),
              date: shortDate(weights[0].date),
            })}
          </p>
        )}
      </section>

      {topFoods.length > 0 && (
        <section className="card card--quiet">
          <div className="card-title">
            <h3>{t('You eat a lot of…')}</h3>
          </div>
          {topFoods.map((food) => (
            <div className="list-row" key={food.name}>
              <span className="thumb thumb--emoji" aria-hidden="true">{food.emoji ?? '🍽️'}</span>
              <span className="grow">
                <b className="small">{food.name}</b>
                <p className="tiny muted">
                  {plural(food.count, { one: '{n} time · {energy} total', other: '{n} times · {energy} total' }, { energy: formatEnergy(food.kcal) })}
                </p>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="card card--quiet">
        <div className="card-title">
          <h3>{t('Achievements')}</h3>
          <span className="tiny muted">
            {ACHIEVEMENTS.filter((a) => unlocked[a.id]).length}/{ACHIEVEMENTS.length}
          </span>
        </div>
        {ACHIEVEMENT_GROUPS.map((group) => {
          const badges = ACHIEVEMENTS.filter((a) => a.group === group.id);
          return (
            <div key={group.id} className="badge-group">
              <div className="badge-group-head">
                <h4 className="tiny">{group.title}</h4>
                <span className="tiny muted">
                  {t('{n} of {total}', { n: badges.filter((a) => unlocked[a.id]).length, total: badges.length })}
                </span>
              </div>
              <div className="badge-grid">
                {badges.map((a) => {
                  const unlocks = unlocksLine(a.id);
                  return (
                    <div key={a.id} className={`achievement ${unlocked[a.id] ? 'is-on' : ''}`} title={a.description}>
                      <span aria-hidden="true">{a.emoji}</span>
                      <b className="tiny">{a.title}</b>
                      <span className="tiny muted">{unlocked[a.id] ? t('unlocked') : a.description}</span>
                      {unlocks && !unlocked[a.id] && <span className="tiny achievement-reward">🎁 {unlocks}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <p className="script center" style={{ fontSize: 20, color: 'var(--ink-2)' }}>
        {t('A happier you, with Squish.')}
      </p>

      <ShareSheet open={sharing} onClose={() => setSharing(false)} data={shareData} />
    </div>
  );
}
