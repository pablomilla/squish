/**
 * One line comparing a good thing to food people know: "About the protein of
 * 3 eggs". See lib/equivalents.ts for which foods and why never calories.
 * Shows nothing when switched off in You → Appearance, or when there is too
 * little to compare.
 */
import { useSquish } from '../store/useSquish';
import type { Equivalent } from '../lib/equivalents';
import './comparison.css';

export default function Comparison({ equivalent, lead = 'About the', tail = '' }: { equivalent: Equivalent | null; lead?: string; tail?: string }) {
  // Only an explicit "off" hides it: a diary saved before the setting existed has none, and means on.
  const on = useSquish((s) => s.comparisons !== false);
  if (!on || !equivalent) return null;
  return (
    <p className="comparison small">
      <span className="comparison-emoji" aria-hidden="true">
        {equivalent.emoji}
      </span>
      <span>
        {lead} {equivalent.nutrient} of <b>{equivalent.amount}</b>
        {tail}
      </span>
    </p>
  );
}
