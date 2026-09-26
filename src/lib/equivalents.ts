/**
 * "The protein of 3 eggs": what an amount of a good thing looks like, in food
 * people know.
 *
 * Only ever for the things worth having more of — protein and fibre — and
 * never calories. Comparing a meal's energy to doughnuts turns food into a
 * scale of sins, which Squish does not do; showing that a lentil soup has the
 * fibre of three apples teaches something and cheers somebody on.
 *
 * The amounts come from the app's own food table, so the comparison agrees
 * with what logging that food would say. Which food is used rotates, so the
 * line does not repeat itself every time.
 */
import { foodById } from './foods';
import { localWords } from './region';
import { plural, pluralForms, t } from './i18n';

export type GoodNutrient = 'protein' | 'fibre';

interface Reference {
  id: string;
  emoji: string;
  /** "{n} egg" / "{n} eggs": whole phrases, so a language can put the number where it goes. */
  forms: { one: string; other: string };
}

const REFERENCES: Record<GoodNutrient, Reference[]> = {
  protein: [
    { id: 'egg', emoji: '🥚', forms: pluralForms({ one: '{n} egg', other: '{n} eggs' }) },
    { id: 'milk', emoji: '🥛', forms: pluralForms({ one: '{n} glass of milk', other: '{n} glasses of milk' }) },
    { id: 'tuna', emoji: '🐟', forms: pluralForms({ one: '{n} tin of tuna', other: '{n} tins of tuna' }) },
    { id: 'chicken', emoji: '🍗', forms: pluralForms({ one: '{n} chicken breast', other: '{n} chicken breasts' }) },
  ],
  fibre: [
    { id: 'apple', emoji: '🍎', forms: pluralForms({ one: '{n} apple', other: '{n} apples' }) },
    { id: 'banana', emoji: '🍌', forms: pluralForms({ one: '{n} banana', other: '{n} bananas' }) },
    { id: 'orange', emoji: '🍊', forms: pluralForms({ one: '{n} orange', other: '{n} oranges' }) },
    { id: 'bread', emoji: '🍞', forms: pluralForms({ one: '{n} slice of wholemeal bread', other: '{n} slices of wholemeal bread' }) },
    { id: 'broccoli', emoji: '🥦', forms: pluralForms({ one: '{n} portion of broccoli', other: '{n} portions of broccoli' }) },
  ],
};

/** Grams of the nutrient in one of the reference food, as the food table has it. */
function gramsIn(ref: Reference, nutrient: GoodNutrient): number {
  const food = foodById(ref.id);
  if (!food) return 0;
  return (food.per100[nutrient] * food.servingG) / 100;
}

/** 1, 1½, 2, 2½ … then whole numbers: halves matter when counting eggs, not when counting twelve of them. */
function friendlyCount(count: number): { text: string; value: number } {
  if (count < 3) {
    const halves = Math.round(count * 2) / 2;
    const whole = Math.floor(halves);
    return { text: halves % 1 ? `${whole}½` : String(whole), value: halves };
  }
  const n = Math.round(count);
  return { text: String(n), value: n };
}

export interface Equivalent {
  nutrient: GoodNutrient;
  emoji: string;
  /** "3 eggs", "1½ slices of wholemeal bread" */
  amount: string;
}

/**
 * The comparison for this many grams, or null when there is too little for
 * one to mean anything. `seed` picks among the foods that give a sensible
 * count — between one and eight — so a day or a meal gets its own.
 */
export function equivalentFor(nutrient: GoodNutrient, grams: number, seed = 0): Equivalent | null {
  if (!(grams > 0)) return null;
  const options = REFERENCES[nutrient]
    .map((ref) => ({ ref, count: grams / (gramsIn(ref, nutrient) || Infinity) }))
    .filter((o) => o.count >= 0.8);
  if (!options.length) return null;
  const sensible = options.filter((o) => o.count <= 8);
  // Past eight of everything, the biggest food keeps the number readable.
  const pool = sensible.length ? sensible : [options.reduce((a, b) => (a.count < b.count ? a : b))];
  const pick = pool[Math.abs(Math.floor(seed)) % pool.length];
  const { text, value } = friendlyCount(Math.max(1, pick.count));
  return { nutrient, emoji: pick.ref.emoji, amount: localWords(plural(value, pick.ref.forms, { n: text })) };
}

/** A stable number from some text — a date, a meal's title — so the same thing gets the same food. */
export function seedFrom(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * The one worth saying about a meal: whichever of protein and fibre makes up
 * more of the day's target, as long as there is enough of it to compare.
 */
export function mealEquivalent(
  totals: { protein: number; fibre: number },
  targets: { protein: number; fibre: number },
  seed: number,
): Equivalent | null {
  const shareProtein = targets.protein ? totals.protein / targets.protein : 0;
  const shareFibre = targets.fibre ? totals.fibre / targets.fibre : 0;
  const order: GoodNutrient[] = shareFibre > shareProtein ? ['fibre', 'protein'] : ['protein', 'fibre'];
  for (const nutrient of order) {
    const found = equivalentFor(nutrient, totals[nutrient], seed);
    if (found) return found;
  }
  return null;
}

/** How far through the day's target, in a few kind words — or nothing, early on. */
export function progressWords(have: number, target: number): string {
  if (!(target > 0)) return '';
  const share = have / target;
  if (share >= 1) return ` ${t('— that’s your target!')}`;
  if (share >= 0.75) return ` ${t('— nearly there')}`;
  return '';
}
