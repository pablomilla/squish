import { useEffect, useMemo, useState } from 'react';
import Squish from '../components/Squish';
import { MacroSplitBar, StreakDots, WeeklyBars, WeightTrend } from '../components/charts';
import { Segmented } from '../components/ui';
import ShareSheet from '../components/ShareSheet';
import type { ShareCardData } from '../lib/share';
import { FlameIcon, ShareIcon } from '../components/icons';
import { ACHIEVEMENTS, useSquish } from '../store/useSquish';
import { daysBetween, isoDate, lastDays, shortDate, weekOf } from '../lib/date';
import { bestStreak, habitCount, habitsOn, mealsOn, series, streakForgaveADay, streakOf, summarise, totalsOn, weightSeries } from '../lib/selectors';
import { MACRO_LABEL } from '../lib/nutrition';
import { formatWeight, formatWeightDelta } from '../lib/units';
import type { MacroKey } from '../types';
import './insights.css';

type Range = '7' | '30' | 'all';
type Metric = 'calories' | 'protein' | 'fibre' | 'score';

const METRIC_UNIT: Record<Metric, string> = { calories: 'kcal', protein: 'g', fibre: 'g', score: 'pts' };

export default function Insights() {
  const [sharing, setSharing] = useState(false);
  const { meals, days, targets, unlocked, profile, unlock } = useSquish();
  const [range, setRange] = useState<Range>('7');
  const [metric, setMetric] = useState<Metric>('calories');
  const today = isoDate();

  const dates = useMemo(() => {
    if (range === '7') return lastDays(7, today);
    if (range === '30') return lastDays(30, today);
    const first = meals.map((m) => m.date).sort()[0];
    const span = first ? Math.max(7, Math.min(120, daysBetween(first, today) + 1)) : 7;
    return lastDays(span, today);
  }, [range, meals, today]);

  const points = useMemo(() => series(meals, dates), [meals, dates]);
  const summary = useMemo(() => summarise(points, targets), [points, targets]);
  const week = weekOf(today);
  const loggedThisWeek = week.map((d) => mealsOn(meals, d).length > 0);
  const streak = streakOf(meals, today);
  const forgave = streakForgaveADay(meals, today);
  const best = bestStreak(meals);
  const weights = useMemo(() => weightSeries(days, 120), [days]);

  // Held steady, because the share sheet redraws the card whenever this changes.
  const shareData = useMemo<ShareCardData>(
    () => ({
      headline: `${streak} day streak`,
      subline:
        summary.loggedDays > 0
          ? `${summary.loggedDays} of the last ${summary.days} days logged, averaging ${summary.avgCalories} kcal.`
          : 'Every day counts.',
      stats: [
        { label: 'best streak', value: `${best}` },
        { label: 'avg quality', value: `${summary.avgScore}` },
        { label: 'meals logged', value: `${meals.length}` },
      ],
      mood: 'cheering',
    }),
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
        };
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 },
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

  const macroAverages = useMemo(() => {
    const logged = points.filter((p) => p.logged).length || 1;
    return (['protein', 'carbs', 'fat', 'fibre'] as MacroKey[]).map((key) => ({
      key,
      avg: Math.round(weekTotals[key] / logged),
      target: targets[key],
    }));
  }, [points, weekTotals, targets]);

  return (
    <div className="screen insights">
      <header className="screen-head">
        <div>
          <h1>Your progress</h1>
          <p>{summary.loggedDays} of {summary.days} days logged</p>
        </div>
        <div className="home-streak">
          <FlameIcon size={18} />
          <b>{streak}</b>
        </div>
      </header>

      <Segmented<Range>
        label="Range"
        value={range}
        onChange={setRange}
        options={[
          { value: '7', label: 'Weekly' },
          { value: '30', label: 'Monthly' },
          { value: 'all', label: 'All time' },
        ]}
      />

      <section className="card">
        <div className="insights-streak">
          <Squish mood={streak >= 3 ? 'cheering' : 'calm'} size={92} />
          <div>
            <p className="speech">
              {streak >= 3
                ? `You're on a ${streak} day streak! Keep it going 💜`
                : 'Log something today and we start a new streak together.'}
            </p>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Best streak: {best} day{best === 1 ? '' : 's'}
            </p>
            {forgave && (
              <p className="tiny" style={{ marginTop: 4, color: 'var(--brand-ink)' }}>
                You missed a day and came back — the streak held. It takes two in a row to lose it.
              </p>
            )}
          </div>
        </div>
        {streak >= 2 && (
          <button type="button" className="btn btn--soft btn--block share-trigger" onClick={() => setSharing(true)}>
            <ShareIcon size={18} /> Share my streak
          </button>
        )}
        <div className="divider" />
        <StreakDots dates={week} done={loggedThisWeek} />
      </section>

      <section className="card">
        <div className="card-title">
          <h3>Daily {metric === 'score' ? 'quality' : metric}</h3>
          <span className="tiny muted">avg {metric === 'calories' ? summary.avgCalories : metric === 'protein' ? summary.avgProtein : metric === 'fibre' ? summary.avgFibre : summary.avgScore} {METRIC_UNIT[metric]}</span>
        </div>
        <WeeklyBars
          points={points.slice(-14)}
          target={metric === 'calories' ? targets.calories : metric === 'protein' ? targets.protein : metric === 'fibre' ? targets.fibre : 75}
          metric={metric}
          unit={METRIC_UNIT[metric]}
        />
        <div className="metric-row">
          {(['calories', 'protein', 'fibre', 'score'] as Metric[]).map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {m === 'score' ? 'Quality' : m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section className="insights-stats">
        <div className="pill-stat">
          <span className="tiny muted">Avg energy</span>
          <b>{summary.avgCalories} kcal</b>
        </div>
        <div className="pill-stat">
          <span className="tiny muted">On-target days</span>
          <b>{summary.onTargetDays}</b>
        </div>
        <div className="pill-stat">
          <span className="tiny muted">Avg quality</span>
          <b>{summary.avgScore}/100</b>
        </div>
        <div className="pill-stat">
          <span className="tiny muted">Habit rate</span>
          <b>{habitScore}%</b>
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h3>Average day</h3>
          <span className="tiny muted">per logged day</span>
        </div>
        <MacroSplitBar totals={{ calories: weekTotals.calories, protein: weekTotals.protein, carbs: weekTotals.carbs, fat: weekTotals.fat, fibre: weekTotals.fibre }} />
        <div className="divider" />
        <div className="avg-grid">
          {macroAverages.map(({ key, avg, target }) => (
            <div key={key} className="avg-cell">
              <span className="tiny muted">{MACRO_LABEL[key]}</span>
              <b>{avg} g</b>
              <span
                className={`tiny ${avg >= target * 0.9 ? 'avg-on' : 'avg-off'}`}
                aria-label={`${Math.round((avg / target) * 100)} per cent of the ${MACRO_LABEL[key]} goal`}
              >
                {avg >= target * 0.9 ? 'on target' : `${Math.round((avg / target) * 100)}%`}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h3>Weight</h3>
          <span className="tiny muted">goal {formatWeight(profile.targetWeightKg, profile.units)}</span>
        </div>
        <WeightTrend points={weights} goalKg={profile.targetWeightKg} units={profile.units} />
        {weights.length >= 2 && (
          <p className="tiny muted" style={{ marginTop: 6 }}>
            {formatWeightDelta(weights[weights.length - 1].weightKg - weights[0].weightKg, profile.units)} since{' '}
            {shortDate(weights[0].date)}
          </p>
        )}
      </section>

      {topFoods.length > 0 && (
        <section className="card card--quiet">
          <div className="card-title">
            <h3>You eat a lot of…</h3>
          </div>
          {topFoods.map((food) => (
            <div className="list-row" key={food.name}>
              <span className="thumb thumb--emoji" aria-hidden="true">{food.emoji ?? '🍽️'}</span>
              <span className="grow">
                <b className="small">{food.name}</b>
                <p className="tiny muted">{food.count} time{food.count === 1 ? '' : 's'} · {Math.round(food.kcal)} kcal total</p>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="card card--quiet">
        <div className="card-title">
          <h3>Achievements</h3>
          <span className="tiny muted">{Object.keys(unlocked).length}/{ACHIEVEMENTS.length}</span>
        </div>
        <div className="badge-grid">
          {ACHIEVEMENTS.map((a) => (
            <div key={a.id} className={`achievement ${unlocked[a.id] ? 'is-on' : ''}`} title={a.description}>
              <span aria-hidden="true">{a.emoji}</span>
              <b className="tiny">{a.title}</b>
              <span className="tiny muted">{unlocked[a.id] ? 'unlocked' : a.description}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="script center" style={{ fontSize: 20, color: 'var(--ink-2)' }}>
        A happier you, with Squish.
      </p>

      <ShareSheet open={sharing} onClose={() => setSharing(false)} data={shareData} />
    </div>
  );
}
