/**
 * How somebody eats, and what they want: the choices for onboarding and for
 * You. The lists and what the AI makes of them are in lib/eating.ts.
 */
import { useId } from 'react';
import { AIMS, AVOIDS, AVOID_OTHER_MAX, DIETS, OBSTACLES, type Aim, type Avoid, type Diet, type Obstacle } from '../lib/eating';
import { t } from '../lib/i18n';
import './eating-fields.css';

type Option<K extends string> = { key: K; emoji: string; label: string };

/** Chips, any number on. */
export function ChipChoices<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<K>[];
  value: K[];
  onChange: (next: K[]) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="eat-chips" role="group" aria-labelledby={id}>
        {options.map((option) => {
          const on = value.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              className="chip"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((k) => k !== option.key) : [...value, option.key])}
            >
              <span aria-hidden="true">{option.emoji}</span>
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One way of eating, as a row of chips: exactly one on. */
export function DietChoice({ value, onChange }: { value: Diet; onChange: (diet: Diet) => void }) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-label" id={id}>
        {t('I eat')}
      </span>
      <div className="eat-chips" role="radiogroup" aria-labelledby={id}>
        {DIETS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            className={`chip ${value === option.key ? 'chip--on' : ''}`}
            aria-checked={value === option.key}
            onClick={() => onChange(option.key)}
          >
            <span aria-hidden="true">{option.emoji}</span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface EatingAnswers {
  diet?: Diet;
  avoid?: Avoid[];
  avoidOther?: string;
}

/** Diet, allergies and foods they never eat, together. */
export function EatingFields({ value, onChange }: { value: EatingAnswers; onChange: (patch: EatingAnswers) => void }) {
  const other = useId();
  return (
    <>
      <DietChoice value={value.diet ?? 'any'} onChange={(diet) => onChange({ diet })} />
      <ChipChoices<Avoid>
        label={t('Allergies, or foods I never eat')}
        options={AVOIDS}
        value={value.avoid ?? []}
        onChange={(avoid) => onChange({ avoid })}
      />
      <div className="field">
        <label htmlFor={other}>{t('Anything else')}</label>
        <input
          id={other}
          className="input"
          value={value.avoidOther ?? ''}
          maxLength={AVOID_OTHER_MAX}
          placeholder={t('Mushrooms, coriander…')}
          onChange={(event) => onChange({ avoidOther: event.target.value })}
        />
      </div>
    </>
  );
}

export interface AimAnswers {
  aims?: Aim[];
  obstacles?: Obstacle[];
}

/** What they are after and what gets in the way. */
export function AimFields({ value, onChange }: { value: AimAnswers; onChange: (patch: AimAnswers) => void }) {
  return (
    <>
      <ChipChoices<Aim> label={t('What would you like from Squish?')} options={AIMS} value={value.aims ?? []} onChange={(aims) => onChange({ aims })} />
      <ChipChoices<Obstacle>
        label={t('What usually gets in the way?')}
        options={OBSTACLES}
        value={value.obstacles ?? []}
        onChange={(obstacles) => onChange({ obstacles })}
      />
    </>
  );
}
