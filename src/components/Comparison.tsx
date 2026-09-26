/**
 * One line comparing a good thing to food people know: "About the protein of
 * 3 eggs". See lib/equivalents.ts for which foods and why never calories.
 * Shows nothing when switched off in You → Appearance, or when there is too
 * little to compare.
 */
import { useSquish } from '../store/useSquish';
import type { Equivalent } from '../lib/equivalents';
import './comparison.css';
import { localWords } from '../lib/region';
import { t } from '../lib/i18n';
import { rich } from '../lib/i18n-react';

/**
 * `meal` reads "About the protein of 3 eggs"; `day` reads "The protein of 3
 * eggs so far", with `tail` after it. Whole sentences, so each language can
 * order them its own way.
 */
export default function Comparison({ equivalent, variant = 'meal', tail = '' }: { equivalent: Equivalent | null; variant?: 'meal' | 'day'; tail?: string }) {
  // Only an explicit "off" hides it: a diary saved before the setting existed has none, and means on.
  const on = useSquish((s) => s.comparisons !== false);
  if (!on || !equivalent) return null;
  return (
    <p className="comparison small">
      <span className="comparison-emoji" aria-hidden="true">
        {equivalent.emoji}
      </span>
      <span>
        {rich(variant === 'day' ? 'The {nutrient} of <b>{amount}</b> so far' : 'About the {nutrient} of <b>{amount}</b>', {
          nutrient: equivalent.nutrient === 'protein' ? t('protein') : localWords(t('fibre')),
          amount: equivalent.amount,
        }, { b: (text) => <b>{text}</b> })}
        {tail}
      </span>
    </p>
  );
}
