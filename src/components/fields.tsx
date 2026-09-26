import { useEffect, useId, useState } from 'react';
import type { Units } from '../lib/units';
import { REGION_LIST, isRegion, type Region } from '../lib/region';
import { LANGUAGE_LIST, isLanguage, type Language } from '../lib/language';
import {
  cmToFeetInches,
  feetInchesToCm,
  inPounds,
  kgToStonePounds,
  stonePoundsToKg,
  poundsToKg,
  KG_PER_POUND,
  POUNDS_RANGE,
  FEET_RANGE,
  HEIGHT_CM_RANGE,
  MAX_POUNDS_IN_STONE,
  STONE_RANGE,
  WEIGHT_KG_RANGE,
} from '../lib/units';

/**
 * Shown at the field's own precision, which is not the store's. Weights are
 * kept to two decimal places of a kilogram so that pounds survive being saved,
 * and a box labelled "kg" should not put 60.33 on screen because of it.
 */
const atPrecision = (n: number, decimals: number) =>
  String(decimals ? Math.round(n * 10 ** decimals) / 10 ** decimals : Math.round(n));

/**
 * A number field that lets you type.
 *
 * The naive version clamps on every keystroke, which makes the field
 * unusable: clearing it snaps back to the minimum, and typing a digit onto an
 * existing value briefly makes a huge number that clamps to the maximum. So
 * the box holds whatever you type, and the value is only clamped when you
 * leave the field.
 */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  min,
  max,
  decimals = 0,
  hideLabel = false,
  onBelowMin,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min: number;
  max: number;
  decimals?: number;
  hideLabel?: boolean;
  /**
   * Called instead of quietly rounding up to `min`, for a field where a
   * number below it means something — an age under 18. The field goes back
   * to what it held before.
   */
  onBelowMin?: (typed: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => atPrecision(value, decimals));

  // Follow the value when it changes from elsewhere — switching units, say.
  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : atPrecision(value, decimals)));
  }, [value, decimals]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || Number.isNaN(parsed)) {
      setDraft(String(value)); // Nothing usable typed — put back what was there.
      return;
    }
    if (parsed < min && onBelowMin) {
      setDraft(atPrecision(value, decimals));
      onBelowMin(parsed);
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    const rounded = decimals ? Math.round(clamped * 10 ** decimals) / 10 ** decimals : Math.round(clamped);
    setDraft(String(rounded));
    onChange(rounded);
  };

  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : undefined}>
        {label}
      </label>
      <div className="input-suffix">
        <input
          id={id}
          className="input"
          // Deliberately text: type="number" swallows partial input and reacts
          // to scroll wheels. inputMode still gives a phone the right keypad.
          type="text"
          inputMode={decimals ? 'decimal' : 'numeric'}
          autoComplete="off"
          value={draft}
          aria-label={hideLabel ? label : undefined}
          onChange={(event) => {
            const next = event.target.value;
            if (!/^\d*\.?\d*$/.test(next)) return; // digits and one dot only
            setDraft(next);
            const parsed = Number(next);
            // Report as you type, but only once it is already in range —
            // clamping waits for blur so half-typed numbers are left alone.
            if (next.trim() !== '' && !Number.isNaN(parsed) && parsed >= min && parsed <= max) {
              onChange(parsed);
            }
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        {suffix && <span>{suffix}</span>}
      </div>
    </div>
  );
}

/** Height, in whichever units are in play. Always stored as centimetres. */
export function HeightField({
  cm,
  units,
  onChange,
}: {
  cm: number;
  units: Units;
  onChange: (cm: number) => void;
}) {
  if (units === 'metric') {
    return (
      <NumberField
        label="Height"
        value={Math.round(cm)}
        suffix="cm"
        min={HEIGHT_CM_RANGE.min}
        max={HEIGHT_CM_RANGE.max}
        onChange={onChange}
      />
    );
  }

  const { feet, inches } = cmToFeetInches(cm);
  return (
    <div className="field">
      <label>Height</label>
      <div className="field-pair">
        <NumberField
          label="Feet"
          hideLabel
          value={feet}
          suffix="ft"
          min={FEET_RANGE.min}
          max={FEET_RANGE.max}
          onChange={(nextFeet) => onChange(feetInchesToCm(nextFeet, inches))}
        />
        <NumberField
          label="Inches"
          hideLabel
          value={inches}
          suffix="in"
          min={0}
          max={11}
          onChange={(nextInches) => onChange(feetInchesToCm(feet, nextInches))}
        />
      </div>
    </div>
  );
}

/** Weight, in whichever units are in play. Always stored as kilograms. */
export function WeightField({
  label,
  kg,
  units,
  onChange,
}: {
  label: string;
  kg: number;
  units: Units;
  onChange: (kg: number) => void;
}) {
  if (units === 'metric') {
    return (
      <NumberField
        label={label}
        value={kg}
        suffix="kg"
        min={WEIGHT_KG_RANGE.min}
        max={WEIGHT_KG_RANGE.max}
        decimals={1}
        onChange={onChange}
      />
    );
  }

  if (inPounds()) {
    return (
      <NumberField
        label={label}
        value={Math.round((kg / KG_PER_POUND) * 10) / 10}
        suffix="lb"
        min={POUNDS_RANGE.min}
        max={POUNDS_RANGE.max}
        decimals={1}
        onChange={(lb) => onChange(poundsToKg(lb))}
      />
    );
  }

  const { stone, pounds } = kgToStonePounds(kg);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="field-pair">
        <NumberField
          label={`${label} in stone`}
          hideLabel
          value={stone}
          suffix="st"
          min={STONE_RANGE.min}
          max={STONE_RANGE.max}
          onChange={(nextStone) => onChange(stonePoundsToKg(nextStone, pounds))}
        />
        <NumberField
          label={`${label} in pounds`}
          hideLabel
          value={pounds}
          suffix="lb"
          min={0}
          // Not 13: a stone holds up to 13.9 lb, and clamping to 13 quietly
          // shaved almost a pound off the weight every time the field blurred.
          max={MAX_POUNDS_IN_STONE}
          decimals={1}
          onChange={(nextPounds) => onChange(stonePoundsToKg(stone, nextPounds))}
        />
      </div>
    </div>
  );
}

/**
 * Which of the six countries they live in. A plain select: six rows fit on
 * any phone, and the phone's own picker is the one people know how to use.
 */
export function RegionField({ value, onChange, hint }: { value: Region; onChange: (region: Region) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Where you live</label>
      <select id={id} className="input input--select" value={value} onChange={(event) => isRegion(event.target.value) && onChange(event.target.value)}>
        {REGION_LIST.map((region) => (
          <option key={region.id} value={region.id}>
            {region.flag} {region.name}
          </option>
        ))}
      </select>
      {hint && <p className="tiny muted">{hint}</p>}
    </div>
  );
}

/** Which language the AI writes in, listed by each language's own name. */
export function LanguageField({ value, onChange, hint }: { value: Language; onChange: (language: Language) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Squish’s AI writes in</label>
      <select id={id} className="input input--select" value={value} onChange={(event) => isLanguage(event.target.value) && onChange(event.target.value)}>
        {LANGUAGE_LIST.map((language) => (
          <option key={language.id} value={language.id} lang={language.id}>
            {language.native}
            {language.native === language.name ? '' : ` — ${language.name}`}
          </option>
        ))}
      </select>
      {hint && <p className="tiny muted">{hint}</p>}
    </div>
  );
}
