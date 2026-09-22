/**
 * A password box with a way to see what you typed.
 *
 * Worth its own component rather than a prop on every form, because the
 * details that make it work are easy to get wrong one at a time: the toggle
 * has to be a `button type="button"` or it submits the form, it has to say
 * which state it is in rather than only showing an icon, and the input has to
 * keep its `autoComplete` so password managers still recognise it when the
 * type flips to `text`.
 *
 * Hidden by default, always. Revealing is something a person asks for, and it
 * lasts as long as the form does — nothing here remembers the choice, because
 * the next time might be on a train.
 */
import { useId, useState } from 'react';
import { EyeIcon, EyeOffIcon } from './icons';
import './password-field.css';

export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  id,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  /** Given where something outside needs to find this input by name. */
  id?: string;
  required?: boolean;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const [shown, setShown] = useState(false);

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-field">
        <input
          id={inputId}
          className="input"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
        />
        <button
          type="button"
          className="password-peek"
          onClick={() => setShown((was) => !was)}
          // Both, deliberately: the label says what pressing it will do, and
          // the pressed state says how things stand. A screen reader user
          // should not have to press it to find out.
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          aria-controls={inputId}
        >
          {shown ? <EyeOffIcon size={19} /> : <EyeIcon size={19} />}
        </button>
      </div>
      {hint && <p className="tiny muted">{hint}</p>}
    </div>
  );
}
