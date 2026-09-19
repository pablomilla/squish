import { useId, useMemo, useState } from 'react';
import type { MacroKey, Nutrients, Targets } from '../types';
import { MACROS } from '../types';
import { MACRO_LABEL, pct } from '../lib/nutrition';
import type { DaySeriesPoint } from '../lib/selectors';
import { shortDate, weekdayLetter } from '../lib/date';
import { formatWeight, saltGrams, type Units } from '../lib/units';
import './charts.css';

export const MACRO_COLOR: Record<MacroKey, string> = {
  protein: 'var(--dv-protein)',
  carbs: 'var(--dv-carbs)',
  fat: 'var(--dv-fat)',
  fibre: 'var(--dv-fibre)',
};

/* ------------------------------------------------------------------ *
 * Calorie ring — one headline number, magnitude by arc length.
 * ------------------------------------------------------------------ */
interface RingProps {
  value: number;
  target: number;
  size?: number;
  label?: string;
  unit?: string;
  color?: string;
  children?: React.ReactNode;
}

export function ProgressRing({ value, target, size = 190, label = 'left', unit = 'kcal', color = 'var(--dv-cal)', children }: RingProps) {
  const stroke = Math.round(size * 0.085);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.max(0, Math.min(1, target > 0 ? value / target : 0));
  const over = target > 0 && value > target;
  const left = Math.max(0, Math.round(target - value));

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-sunk)" strokeWidth={stroke} />
        {fraction > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={over ? 'var(--warn)' : color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * fraction} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="ring-arc"
          />
        )}
      </svg>
      <div className="ring-center">
        {children ?? (
          <>
            <b>{over ? `+${Math.round(value - target)}` : left}</b>
            <span>{unit} {over ? 'over' : label}</span>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Macro bars — identity by fixed hue order, always direct-labelled.
 * ------------------------------------------------------------------ */
/**
 * Sugar and sodium, which the app has always worked out and never shown.
 * They get a quieter treatment than the macros — a number against a limit
 * rather than a bar, because they are ceilings to stay under, not targets to
 * reach, and a full bar should not look like an achievement.
 */
export function MinorNutrients({ totals, targets }: { totals: Nutrients; targets: Targets }) {
  const rows = [
    { key: 'sugar' as const, label: 'Sugar', value: Math.round(totals.sugar ?? 0), limit: Math.round(targets.sugar ?? 0), unit: 'g' },
    { key: 'sodium' as const, label: 'Salt', value: saltGrams(totals.sodium ?? 0), limit: saltGrams(targets.sodium ?? 0), unit: 'g' },
  ].filter((row) => row.limit > 0); // No limit set, nothing meaningful to say.

  if (!rows.length) return null;

  return (
    <div className="minor-nutrients">
      {rows.map((row) => (
        <div className="minor-nutrient" key={row.key}>
          <span className="tiny muted">{row.label}</span>
          <span className={`small ${row.value > row.limit ? 'is-over' : ''}`}>
            <b>{row.value.toLocaleString()}</b>
            <span className="muted">
              {' '}
              / {row.limit.toLocaleString()} {row.unit}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function MacroBars({ totals, targets, compact = false }: { totals: Nutrients; targets: Targets; compact?: boolean }) {
  return (
    <div className={`macro-bars ${compact ? 'macro-bars--compact' : ''}`}>
      {MACROS.map((key) => {
        const value = Math.round(totals[key]);
        const target = Math.round(targets[key]);
        const fraction = Math.min(1, pct(value, target));
        const over = value > target * 1.05;
        return (
          <div className="macro-bar" key={key}>
            <div className="macro-bar-head">
              <span className="macro-dot" style={{ background: MACRO_COLOR[key] }} aria-hidden="true" />
              <span className="macro-name">{MACRO_LABEL[key]}</span>
              <span className="macro-value">
                <b>{value}</b>
                <span className="muted"> / {target} g</span>
              </span>
            </div>
            <div className="macro-track" role="img" aria-label={`${MACRO_LABEL[key]}: ${value} of ${target} grams`}>
              <span
                className="macro-fill"
                style={{ width: `${fraction * 100}%`, background: MACRO_COLOR[key], opacity: over ? 0.72 : 1 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Stacked energy split — one row, 2px gaps between segments. */
export function MacroSplitBar({ totals }: { totals: Nutrients }) {
  const parts = [
    { key: 'protein' as const, kcal: totals.protein * 4 },
    { key: 'carbs' as const, kcal: totals.carbs * 4 },
    { key: 'fat' as const, kcal: totals.fat * 9 },
  ];
  const total = parts.reduce((s, p) => s + p.kcal, 0);
  if (total <= 0) return <div className="split-bar split-bar--empty" />;

  return (
    <>
      <div className="split-bar">
        {parts.map((p) => (
          <span
            key={p.key}
            className="split-seg"
            style={{ width: `${(p.kcal / total) * 100}%`, background: MACRO_COLOR[p.key] }}
            title={`${MACRO_LABEL[p.key]} ${Math.round((p.kcal / total) * 100)}%`}
          />
        ))}
      </div>
      <div className="split-legend">
        {parts.map((p) => (
          <span key={p.key}>
            <span className="macro-dot" style={{ background: MACRO_COLOR[p.key] }} aria-hidden="true" />
            {MACRO_LABEL[p.key]} {Math.round((p.kcal / total) * 100)}%
          </span>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Weekly bars — magnitude over time, one axis, hover tooltip, table view.
 * ------------------------------------------------------------------ */
interface WeeklyProps {
  points: DaySeriesPoint[];
  target: number;
  metric?: 'calories' | 'protein' | 'fibre' | 'score';
  unit?: string;
}

const METRIC_COLOR: Record<NonNullable<WeeklyProps['metric']>, string> = {
  calories: 'var(--dv-cal)',
  protein: 'var(--dv-protein)',
  fibre: 'var(--dv-fibre)',
  score: 'var(--mint)',
};

export function WeeklyBars({ points, target, metric = 'calories', unit = 'kcal' }: WeeklyProps) {
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const max = useMemo(
    () => Math.max(target * 1.15, ...points.map((p) => p[metric]), 1),
    [points, target, metric],
  );

  const height = 132;
  const color = METRIC_COLOR[metric];

  return (
    <figure className="chart">
      <div className="chart-plot" style={{ height }} onPointerLeave={() => setActive(null)}>
        {target > 0 && (
          <div className="chart-target" style={{ bottom: `${(target / max) * 100}%` }}>
            <span>target {Math.round(target)}</span>
          </div>
        )}
        <div className="chart-bars">
          {points.map((point, index) => {
            const value = point[metric];
            const isActive = active === index;
            return (
              <button
                type="button"
                key={point.date}
                className={`chart-bar ${isActive ? 'is-active' : ''}`}
                onPointerEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(isActive ? null : index)}
                aria-label={`${shortDate(point.date)}: ${value} ${unit}`}
              >
                <span className="chart-bar-hit" />
                <span
                  className="chart-bar-fill"
                  style={{
                    height: `${Math.max(value > 0 ? 5 : 2, (value / max) * 100)}%`,
                    background: value > 0 ? color : 'var(--surface-sunk)',
                  }}
                />
                {isActive && value > 0 && <span className="chart-bar-label">{value}</span>}
                <span className="chart-bar-day">{weekdayLetter(point.date)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <figcaption className="chart-caption">
        <button type="button" className="btn--quiet tiny" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide table' : 'View as table'}
        </button>
      </figcaption>

      {showTable && (
        <table className="chart-table" id={tableId}>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">{unit}</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <th scope="row">{shortDate(p.date)}</th>
                <td>{p[metric] || '—'}</td>
                <td>{p.score || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Weight trend — 2px line, 8px markers, hover readout.
 * ------------------------------------------------------------------ */
export function WeightTrend({
  points,
  goalKg,
  units = 'metric',
}: {
  points: { date: string; weightKg: number }[];
  goalKg?: number;
  units?: Units;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) {
    return <p className="empty">Log your weight on a couple of days and the trend will show up here.</p>;
  }

  const w = 320;
  const h = 120;
  const pad = 14;
  const values = points.map((p) => p.weightKg).concat(goalKg ? [goalKg] : []);
  const min = Math.min(...values) - 0.6;
  const max = Math.max(...values) + 0.6;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (points.length - 1);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.weightKg).toFixed(1)}`).join(' ');
  const current = active ?? points.length - 1;
  const dense = points.length > 14;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} className="trend" role="img" aria-label="Weight trend over time">
        {goalKg && (
          <line x1={pad} x2={w - pad} y1={y(goalKg)} y2={y(goalKg)} stroke="var(--dv-grid)" strokeWidth="2" strokeDasharray="4 5" />
        )}
        <path d={path} fill="none" stroke="var(--dv-cal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={`hit-${p.date}`}
            cx={x(i)}
            cy={y(p.weightKg)}
            r="11"
            fill="transparent"
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
          />
        ))}
        {points.map((p, i) => (
          <circle
            key={p.date}
            cx={x(i)}
            cy={y(p.weightKg)}
            // Dense series would turn into a string of beads — keep the ends and the hovered point.
            r={i === current ? 6 : dense && i !== 0 && i !== points.length - 1 ? 0 : 4}
            fill={i === current ? 'var(--dv-cal)' : 'var(--surface)'}
            stroke="var(--dv-cal)"
            strokeWidth="2"
            pointerEvents="none"
          />
        ))}
      </svg>
      <figcaption className="chart-readout">
        <b>{formatWeight(points[current].weightKg, units)}</b>
        <span className="muted"> · {shortDate(points[current].date)}</span>
        {goalKg && <span className="muted"> · goal {formatWeight(goalKg, units)}</span>}
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Habit dots — state, not magnitude: tick + label, never colour alone.
 * ------------------------------------------------------------------ */
export function StreakDots({ dates, done }: { dates: string[]; done: boolean[] }) {
  return (
    <div className="streak-dots">
      {dates.map((date, i) => (
        <div className="streak-day" key={date}>
          <span className={`streak-dot ${done[i] ? 'is-done' : ''}`} aria-hidden="true">
            {done[i] ? '✓' : ''}
          </span>
          <span className="tiny muted">{weekdayLetter(date)}</span>
          <span className="visually-hidden">{done[i] ? 'logged' : 'not logged'}</span>
        </div>
      ))}
    </div>
  );
}

/** Small score meter used on meal cards. */
export function ScoreMeter({ score, size = 44 }: { score: number; size?: number }) {
  const tone = score >= 75 ? 'var(--good)' : score >= 45 ? 'var(--warn)' : 'var(--bad)';
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="score-meter" role="img" aria-label={`Quality score ${score} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunk)" strokeWidth="5" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(c * Math.min(100, score)) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="53%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.32} fontWeight="600" fill="var(--ink)">
        {score}
      </text>
    </svg>
  );
}
