/**
 * Scrolling dials for onboarding: a wheel for height and weight, a ruler for
 * the weight somebody is aiming for. Quicker than typing on a phone, and
 * impossible to get wildly wrong — a thumb cannot type 1,750 kg.
 *
 * Both are ordinary scrolling boxes underneath, so they move with a finger,
 * a trackpad and a mouse wheel, and snap to a value when they stop. Both work
 * from the keyboard too: the wheel as a list box (arrows, Page Up/Down, Home,
 * End), the ruler as a slider.
 *
 * Values are always stored in centimetres and kilograms; the dials show
 * whichever units are in play, the same as the fields they replace
 * (components/fields.tsx), which the You screen still uses.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CM_PER_INCH,
  FEET_RANGE,
  HEIGHT_CM_RANGE,
  KG_PER_POUND,
  POUNDS_PER_STONE,
  POUNDS_RANGE,
  STONE_RANGE,
  WEIGHT_KG_RANGE,
  formatWeight,
  inPounds,
  poundsToKg,
  type Units,
} from '../lib/units';
import { t } from '../lib/i18n';
import './dials.css';

interface Option {
  value: number;
  label: string;
}

/** The height of one row of a wheel, in pixels; five rows show at once. */
const ROW = 44;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function nearest(options: Option[], value: number): number {
  let best = 0;
  for (let i = 1; i < options.length; i++) if (Math.abs(options[i].value - value) < Math.abs(options[best].value - value)) best = i;
  return best;
}

/**
 * A wheel: a column of values that scrolls and snaps, the middle one chosen.
 * A value that falls between two rows (a weight typed elsewhere as 72.4 kg)
 * shows the nearest, and is not changed until the wheel is moved.
 */
export function Wheel({ label, options, value, onChange }: { label: string; options: Option[]; value: number; onChange: (value: number) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const selected = nearest(options, value);
  const [centre, setCentre] = useState(selected);
  const id = useId();

  // Brought into place when the value changes from outside: first showing,
  // the units switched, or a key pressed. Not while a finger is moving it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - selected * ROW) > ROW / 2) el.scrollTop = selected * ROW;
    setCentre(selected);
  }, [selected, options]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const at = clamp(Math.round(el.scrollTop / ROW), 0, options.length - 1);
    if (at === centre) return;
    setCentre(at);
    if (at !== selected) onChange(options[at].value);
  };

  const step = (by: number) => onChange(options[clamp(selected + by, 0, options.length - 1)].value);

  return (
    <div className="dial">
      <span className="dial-label" id={id}>
        {label}
      </span>
      <div className="wheel">
        <div
          ref={box}
          className="wheel-scroll"
          role="listbox"
          tabIndex={0}
          aria-labelledby={id}
          aria-activedescendant={`${id}-${selected}`}
          onScroll={onScroll}
          onKeyDown={(event) => {
            const by = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[event.key];
            if (by !== undefined) step(by);
            else if (event.key === 'Home') onChange(options[0].value);
            else if (event.key === 'End') onChange(options[options.length - 1].value);
            else return;
            event.preventDefault();
          }}
        >
          {options.map((option, i) => (
            <div
              key={option.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === selected}
              className={`wheel-row ${i === centre ? 'is-on' : Math.abs(i - centre) === 1 ? 'is-near' : ''}`}
              onClick={() => box.current?.scrollTo({ top: i * ROW, behavior: 'smooth' })}
            >
              {option.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Height as a wheel: centimetres, or feet and inches. */
export function HeightWheel({ cm, units, onChange }: { cm: number; units: Units; onChange: (cm: number) => void }) {
  const options = useMemo<Option[]>(() => {
    if (units === 'metric') {
      return Array.from({ length: HEIGHT_CM_RANGE.max - HEIGHT_CM_RANGE.min + 1 }, (_, i) => {
        const value = HEIGHT_CM_RANGE.min + i;
        return { value, label: `${value} cm` };
      });
    }
    const from = FEET_RANGE.min * 12;
    return Array.from({ length: (FEET_RANGE.max + 1) * 12 - from }, (_, i) => {
      const inches = from + i;
      return { value: Math.round(inches * CM_PER_INCH * 10) / 10, label: `${Math.floor(inches / 12)}′ ${inches % 12}″` };
    });
  }, [units]);
  return <Wheel label={t('Height')} options={options} value={cm} onChange={(value) => onChange(Math.round(value))} />;
}

/** Weight as a wheel: whole kilograms, pounds, or stones and pounds. */
export function WeightWheel({ label, kg, units, onChange }: { label: string; kg: number; units: Units; onChange: (kg: number) => void }) {
  const pounds = units !== 'metric' && inPounds();
  const options = useMemo<Option[]>(() => {
    if (units === 'metric') {
      return Array.from({ length: WEIGHT_KG_RANGE.max - WEIGHT_KG_RANGE.min + 1 }, (_, i) => {
        const value = WEIGHT_KG_RANGE.min + i;
        return { value, label: `${value} kg` };
      });
    }
    const [lo, hi] = pounds ? [POUNDS_RANGE.min, POUNDS_RANGE.max] : [STONE_RANGE.min * POUNDS_PER_STONE, STONE_RANGE.max * POUNDS_PER_STONE];
    return Array.from({ length: hi - lo + 1 }, (_, i) => {
      const lb = lo + i;
      return {
        value: poundsToKg(lb),
        label: pounds ? `${lb} lb` : `${Math.floor(lb / POUNDS_PER_STONE)} st ${lb % POUNDS_PER_STONE} lb`,
      };
    });
  }, [units, pounds]);
  return <Wheel label={label} options={options} value={kg} onChange={onChange} />;
}

/** The space between two marks on the ruler, in pixels. */
const GAP = 10;

/**
 * A ruler: slide it left and right under a fixed mark. Its marks are drawn
 * as a background rather than an element each, because at a tenth of a
 * kilogram there are two thousand of them.
 */
export function Ruler({
  label,
  value,
  min,
  max,
  step,
  major,
  from,
  describe,
  onChange,
}: {
  label: string;
  /** In the units shown. */
  value: number;
  min: number;
  max: number;
  step: number;
  /** Marks between the long ones. */
  major: number;
  /** Where they start (today's weight): the stretch to the value is shaded. */
  from?: number;
  describe: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const count = Math.round((max - min) / step);
  const indexOf = (v: number) => clamp(Math.round((v - min) / step), 0, count);
  const valueAt = (i: number) => Math.round((min + i * step) * 100) / 100;
  const index = indexOf(value);
  const settle = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && Math.abs(el.scrollLeft - index * GAP) > GAP / 2) el.scrollLeft = index * GAP;
  }, [index]);

  // A mouse wheel turned up and down moves the ruler along.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const at = clamp(Math.round(el.scrollLeft / GAP), 0, count);
    if (at !== index) onChange(valueAt(at));
    // Lined up exactly on a mark once it stops.
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => el.scrollTo({ left: at * GAP, behavior: 'smooth' }), 140);
  };

  const shade =
    from === undefined
      ? null
      : { left: Math.min(indexOf(from), index) * GAP, width: Math.abs(index - indexOf(from)) * GAP };

  return (
    <div className="ruler">
      <div
        ref={box}
        className="ruler-scroll"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={describe(value)}
        onScroll={onScroll}
        onKeyDown={(event) => {
          const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: major, PageDown: -major }[event.key];
          if (by === undefined) return;
          event.preventDefault();
          onChange(valueAt(clamp(index + by * (event.shiftKey ? major : 1), 0, count)));
        }}
      >
        <div
          className="ruler-marks"
          style={{
            width: count * GAP + 2,
            backgroundImage: `repeating-linear-gradient(to right, var(--ink-2) 0 2px, transparent 2px ${major * GAP}px), repeating-linear-gradient(to right, var(--ink-3) 0 1px, transparent 1px ${GAP}px)`,
          }}
        >
          {shade && <span className="ruler-shade" style={shade} />}
        </div>
      </div>
    </div>
  );
}

/**
 * The weight somebody is aiming for, on a ruler: a tenth of a kilogram, or
 * half a pound, at a time, today's weight marked by where the shading starts.
 */
export function GoalWeightRuler({ kg, fromKg, units, goal, onChange }: { kg: number; fromKg: number; units: Units; goal: 'lose' | 'gain'; onChange: (kg: number) => void }) {
  const metric = units === 'metric';
  const toShown = (value: number) => (metric ? value : value / KG_PER_POUND);
  const [min, max, step] = metric ? [WEIGHT_KG_RANGE.min, WEIGHT_KG_RANGE.max, 0.1] : [65, POUNDS_RANGE.max, 0.5];
  const shown = Math.round(toShown(kg) / step) * step;
  const toKg = (value: number) => (metric ? Math.round(value * 10) / 10 : poundsToKg(value));
  return (
    <div className="goal-ruler">
      <p className="goal-ruler-what small muted">{goal === 'gain' ? t('Gain weight') : t('Lose weight')}</p>
      <p className="goal-ruler-value" aria-live="polite">
        {formatWeight(kg, units)}
      </p>
      <Ruler
        label={t('Goal weight')}
        value={shown}
        min={min}
        max={max}
        step={step}
        major={10}
        from={toShown(fromKg)}
        describe={(value) => formatWeight(toKg(value), units)}
        onChange={(value) => onChange(toKg(value))}
      />
    </div>
  );
}
