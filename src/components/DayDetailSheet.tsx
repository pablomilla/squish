/**
 * "Sugar, salt and more" for a day: the same sheet from Home and from the
 * diary, so the link means the same thing wherever it is tapped. Everything
 * the day's cards leave out is here at once — the limits to stay under, the
 * vitamins and minerals, and where the energy came from.
 */
import { useMemo } from 'react';
import type { Nutrients, Targets } from '../types';
import { MacroSplitBar, Micronutrients, MinorNutrients } from './charts';
import Comparison from './Comparison';
import { Sheet } from './ui';
import { equivalentFor, progressWords, seedFrom, type GoodNutrient } from '../lib/equivalents';
import { isoDate } from '../lib/date';
import { saltLabel } from '../lib/units';
import { t } from '../lib/i18n';

export function dayDetailTitle(): string {
  return t('Sugar, {salt} and more', { salt: saltLabel().toLocaleLowerCase() });
}

export default function DayDetailSheet({ open, onClose, date, totals, targets }: { open: boolean; onClose: () => void; date: string; totals: Nutrients; targets: Targets }) {
  // One good thing about the day in food terms. Protein one day, fibre the
  // next, and a different food each day, so it stays worth reading.
  const comparison = useMemo(() => {
    const seed = seedFrom(date);
    const order: GoodNutrient[] = seed % 2 ? ['fibre', 'protein'] : ['protein', 'fibre'];
    for (const nutrient of order) {
      const equivalent = equivalentFor(nutrient, totals[nutrient], seed >> 1);
      if (equivalent) return equivalent;
    }
    return null;
  }, [date, totals]);
  // "So far" only while the day is still going.
  const today = date === isoDate();

  return (
    <Sheet open={open} onClose={onClose} title={dayDetailTitle()}>
      <div className="stack">
        {comparison && (
          <Comparison equivalent={comparison} variant={today ? 'day' : 'meal'} tail={progressWords(totals[comparison.nutrient], targets[comparison.nutrient])} />
        )}
        <MinorNutrients totals={totals} targets={targets} />
        {totals.micros && (
          <>
            <div className="divider" />
            <Micronutrients totals={totals} targets={targets} />
          </>
        )}
        <div className="divider" />
        <MacroSplitBar totals={totals} />
      </div>
    </Sheet>
  );
}
