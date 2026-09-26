import { useId, useMemo, useState } from 'react';
import type { MacroKey, Nutrients, Targets } from '../types';
import { MACROS, MICROS } from '../types';
import { CEILING_LABEL, MACRO_LABEL, MICRO_LABEL, MICRO_UNIT, OVER, ceilingLimit, isCeiling, overPhrase, pct, round1 } from '../lib/nutrition';
import type { OverTarget } from '../lib/nutrition';
import type { DaySeriesPoint } from '../lib/selectors';
import { shortDate, weekdayLetter } from '../lib/date';
import { formatWeight, saltShown, saltUnit, type Units } from '../lib/units';
import { currentEnergyUnit, energyValue } from '../lib/region';
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

/** Energy by default, in whichever unit they count in; `unit` for anything else. */
export function ProgressRing({ value: raw, target: rawTarget, size = 190, label = 'left', unit, color = 'var(--dv-cal)', children }: RingProps) {
  const value = unit ? raw : energyValue(raw);
  const target = unit ? rawTarget : energyValue(rawTarget);
  unit ??= currentEnergyUnit();
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
            <b>{over ? `+${Math.round(value - target).toLocaleString()}` : left.toLocaleString()}</b>
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
    // The two that are only shown once something has actually reported a
    // figure. A day of meals logged before Squish asked for them would
    // otherwise read as a day with none in it.
    ...(totals.satFat === undefined
      ? []
      : [{ key: 'satFat' as const, label: 'Saturates', value: round1(totals.satFat), limit: Math.round(targets.satFat ?? 0), unit: 'g' }]),
    ...(totals.freeSugar === undefined
      ? []
      : [{ key: 'freeSugar' as const, label: 'Free sugars', value: round1(totals.freeSugar), limit: Math.round(targets.freeSugar ?? 0), unit: 'g' }]),
    // Against the limit, not the aim. Total sugars aim at 10% of energy but
    // are only over at the labelling reference intake — showing the aim here
    // turned a day of fruit amber, which is the thing free sugars just fixed.
    { key: 'sugar' as const, label: 'Sugar', value: Math.round(totals.sugar ?? 0), limit: ceilingLimit('sugar', targets), unit: 'g' },
    { key: 'sodium' as const, label: CEILING_LABEL.sodium, value: saltShown(totals.sodium ?? 0), limit: saltShown(targets.sodium ?? 0), unit: saltUnit() },
  ].filter((row) => row.limit > 0); // No limit set, nothing meaningful to say.

  if (!rows.length) return null;

  // Four across at 390px leaves 76px a tile, which "Free sugars" will not fit
  // in. Four goes two by two; anything less stays on one line.
  const columns = rows.length === 4 ? 2 : rows.length;

  return (
    <div className="minor-nutrients" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
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

/**
 * Vitamins and minerals, against what a day is supposed to contain.
 *
 * Shown as a share of the daily intake rather than as raw numbers, because
 * nobody knows off-hand whether 1.4 mg of iron is a lot. Collapsed by default:
 * this is the part of the diary you go looking for, not the part you need
 * shoved at you every time you log a sandwich.
 *
 * It renders nothing at all when nothing reported any, which is the common
 * case for a day logged entirely by barcode.
 */
export function Micronutrients({ totals, targets }: { totals: Nutrients; targets: Targets }) {
  if (!totals.micros) return null;

  const rows = MICROS.map((key) => ({
    key,
    label: MICRO_LABEL[key],
    unit: MICRO_UNIT[key],
    value: totals.micros?.[key] ?? 0,
    target: targets.micros?.[key] ?? 0,
  })).filter((row) => row.target > 0);

  if (!rows.length) return null;

  return (
    <details className="card micro-card">
      <summary className="card-title">
        <h3>Vitamins &amp; minerals</h3>
        <span className="tiny muted">{rows.filter((r) => r.value >= r.target).length} of {rows.length} met</span>
      </summary>

      <div className="micro-list">
        {rows.map((row) => {
          const share = Math.min(1, row.value / row.target);
          const met = row.value >= row.target;
          return (
            <div className="micro-row" key={row.key}>
              <span className="tiny micro-name">{row.label}</span>
              <div
                className="macro-track micro-track"
                role="img"
                aria-label={`${row.label}: ${round1(row.value)} of ${row.target} ${row.unit}`}
              >
                <span
                  className="macro-fill"
                  style={{ width: `${share * 100}%`, backgroundColor: met ? 'var(--good)' : 'var(--dv-cal)' }}
                />
              </div>
              <span className="tiny micro-value">
                <b>{round1(row.value)}</b>
                <span className="muted"> / {row.target} {row.unit}</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* The estimate is rougher here than it is for calories, and a number
          that looks precise about a vitamin invites more trust than it has
          earned. */}
      <p className="tiny muted micro-note">
        Estimated from what you logged, so treat these as a rough guide. Anything logged without a figure for a
        vitamin is not counted towards it.
      </p>
    </details>
  );
}

export function MacroBars({ totals, targets, compact = false }: { totals: Nutrients; targets: Targets; compact?: boolean }) {
  return (
    <div className={`macro-bars ${compact ? 'macro-bars--compact' : ''}`}>
      {MACROS.map((key) => {
        const value = Math.round(totals[key]);
        const target = Math.round(targets[key]);
        const fraction = Math.min(1, pct(value, target));
        // Only fat and carbs can be "over" in a way worth warning about, and
        // only past their limit rather than their aim — 30% of energy from fat
        // is the target, 35% is where the guidance says too much begins.
        // Protein and fibre past target is the thing we keep asking for, and it
        // used to be dimmed as though it were a mistake.
        const over = isCeiling(key) && value > ceilingLimit(key, targets) * OVER;
        return (
          <div className={`macro-bar ${over ? 'is-over' : ''}`} key={key}>
            <div className="macro-bar-head">
              <span className="macro-dot" style={{ background: MACRO_COLOR[key] }} aria-hidden="true" />
              <span className="macro-name">{MACRO_LABEL[key]}</span>
              <span className="macro-value">
                <b>{value}</b>
                <span className="muted"> / {target} g</span>
              </span>
            </div>
            <div
              className="macro-track"
              role="img"
              aria-label={`${MACRO_LABEL[key]}: ${value} of ${target} grams${over ? ', over target' : ''}`}
            >
              {/* backgroundColor, not background: the shorthand would wipe out
                  the stripes the stylesheet lays over an out-of-range bar. */}
              <span className="macro-fill" style={{ width: `${fraction * 100}%`, backgroundColor: MACRO_COLOR[key] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * What went over, said plainly.
 *
 * The bars carry the numbers, but a bar that is full looks much the same
 * whether it is at 100% or at 290% — and a score reading "Balanced" beside it
 * settled the argument the wrong way. This says the size of it in words.
 */
export function OverTargetNote({ over }: { over: OverTarget[] }) {
  if (!over.length) return null;
  const loud = over.some((o) => o.level === 'way-over');

  return (
    <div className={`over-note ${loud ? 'over-note--loud' : ''}`} role="note">
      <span className="over-note-mark" aria-hidden="true">
        !
      </span>
      <div className="grow">
        {/* No "today" — the diary shows other days, and it was wrong on those.
            "Limit" rather than "target": for fat that is a different, higher
            number, and being above the target is not the thing being reported. */}
        <b className="small">{loud ? 'Well over the limit' : 'Over the limit'}</b>
        <ul className="over-note-list">
          {over.map((o) => {
            const salt = o.key === 'sodium';
            const value = salt ? saltShown(o.value) : Math.round(o.value);
            const target = salt ? saltShown(o.target) : Math.round(o.target);
            const unit = salt ? saltUnit() : 'g';
            return (
              <li className="tiny" key={o.key}>
                {CEILING_LABEL[o.key]} {value.toLocaleString()} {unit} — {overPhrase(o)} your {target.toLocaleString()} {unit} limit.
              </li>
            );
          })}
        </ul>
      </div>
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
  /** Days, or averaged weeks or months: `label` goes under the bar, `title` says in full what it is. */
  points: (DaySeriesPoint & { label?: string; title?: string })[];
  target: number;
  metric?: 'calories' | 'protein' | 'carbs' | 'fat' | 'fibre' | 'sugar' | 'salt' | 'score';
  unit?: string;
  /** Ceilings read the other way round: the target line is one to stay below. */
  ceiling?: boolean;
}

const METRIC_COLOR: Record<NonNullable<WeeklyProps['metric']>, string> = {
  calories: 'var(--dv-cal)',
  protein: 'var(--dv-protein)',
  carbs: 'var(--dv-carbs)',
  fat: 'var(--dv-fat)',
  fibre: 'var(--dv-fibre)',
  sugar: 'var(--dv-sugar)',
  salt: 'var(--dv-salt)',
  score: 'var(--mint)',
};

export function WeeklyBars({ points, target, metric = 'calories', unit = 'kcal', ceiling = false }: WeeklyProps) {
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
            <span>{ceiling ? 'limit' : 'target'} {round1(target).toLocaleString()}</span>
          </div>
        )}
        {/* Thirty bars on a phone need the gaps down to the 2px that still separates them. */}
        <div className={`chart-bars ${points.length > 14 ? 'chart-bars--dense' : ''}`}>
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
                aria-label={`${point.title ?? shortDate(point.date)}: ${value} ${unit}`}
              >
                <span className="chart-bar-hit" />
                <span
                  className={`chart-bar-fill ${ceiling && target > 0 && value > target ? 'is-over' : ''}`}
                  style={{
                    height: `${Math.max(value > 0 ? 5 : 2, (value / max) * 100)}%`,
                    backgroundColor: value > 0 ? color : 'var(--surface-sunk)',
                  }}
                />
                <span className="chart-bar-day">{point.label ?? weekdayLetter(point.date)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <figcaption className="chart-caption">
        {/* The figure for the bar being touched, in a line of its own under the chart: floating it
            above the bar put it over the card's heading whenever the bar was tall. */}
        <span className="chart-readout" aria-live="polite">
          {active !== null && points[active] ? (
            <>
              {points[active].title ?? shortDate(points[active].date)} ·{' '}
              <b>{points[active][metric] > 0 ? `${points[active][metric].toLocaleString('en-GB')} ${unit}` : 'nothing logged'}</b>
            </>
          ) : (
            <span className="muted">Tap a bar for its figure</span>
          )}
        </span>
        <button type="button" className="btn--quiet tiny" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide table' : 'View as table'}
        </button>
      </figcaption>

      {showTable && (
        <table className="chart-table" id={tableId}>
          <thead>
            <tr>
              <th scope="col">{points[0]?.title?.startsWith('Week') ? 'Week' : 'Day'}</th>
              <th scope="col">{unit}</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <th scope="row">{p.title ?? shortDate(p.date)}</th>
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
      <figcaption className="trend-readout">
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

/**
 * A meal's or a day's food-quality score: a rounded tile, never a ring. Rings in Squish are amounts — calories, water, a target filling
 * up — and the quality score looked like one more of them, which it is not:
 * it says what the food was made of, not how much of it there was. The tile
 * is its own shape so the two can never be mistaken for each other.
 *
 * Nought means unscored, not awful, so it gets a dash rather than a zero.
 */
export function ScoreMeter({ score, size = 44, label = size >= 50 }: { score: number; size?: number; label?: boolean }) {
  const scored = score > 0;
  const band = !scored ? 'none' : score >= 75 ? 'great' : score >= 55 ? 'good' : score >= 38 ? 'soso' : 'room';
  return (
    <span
      className={`quality-tile quality-tile--${band}`}
      style={{ width: size, height: size, fontSize: size * (label ? 0.36 : 0.4) }}
      role="img"
      aria-label={scored ? `Food quality ${score} out of 100` : 'No calories to score'}
    >
      <b>{scored ? score : '–'}</b>
      {label && <span className="quality-word">quality</span>}
    </span>
  );
}
