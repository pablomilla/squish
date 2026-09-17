import { useEffect, useId, useState } from 'react';
import type { Units } from '../lib/units';
import { cmToFeetInches, feetInchesToCm, kgToStonePounds, MAX_POUNDS_IN_STONE, stonePoundsToKg } from '../lib/units';

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
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min: number;
  max: number;
  decimals?: number;
  hideLabel?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => String(value));

  // Follow the value when it changes from elsewhere — switching units, say.
  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || Number.isNaN(parsed)) {
      setDraft(String(value)); // Nothing usable typed — put back what was there.
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
    return <NumberField label="Height" value={Math.round(cm)} suffix="cm" min={120} max={220} onChange={onChange} />;
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
          min={3}
          max={7}
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
    return <NumberField label={label} value={kg} suffix="kg" min={35} max={250} decimals={1} onChange={onChange} />;
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
          min={5}
          max={39}
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
