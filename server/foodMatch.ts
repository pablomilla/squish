/**
 * Matching a food the AI named to a row of the food table — cautiously.
 *
 * A wrong match is worse than none: "rice" matched to rice bran is three
 * times the calories, stated with a government's authority. So a match has
 * to clear every one of these, and anything that does not keeps the AI's own
 * figures:
 *
 *   1. The AI gave a table name at all. It leaves it empty for a mixed dish,
 *      a takeaway and a branded product, which a table cannot answer.
 *   2. Every word it used is in the row ("chicken breast roasted" needs
 *      chicken and breast, and a cooked row).
 *   3. The row's leading words — what the food *is* in a table's own
 *      wording, "Rice" in "Rice, white, cooked" and "Rice bran" in "Rice
 *      bran, crude" — are all words it used. That is what keeps rice from
 *      matching rice bran, and apple from matching apple pie.
 *   4. Raw means raw and cooked means cooked: 100 g of raw rice is nearly
 *      three times the energy of 100 g of boiled.
 *   5. The calories come out within a factor of two of the AI's own estimate
 *      for the portion. Above that, the AI and the table disagree about what
 *      the food is, and the match is the likelier mistake.
 *
 * Of the rows that clear them, the one with the fewest words the AI did not
 * say wins: "Bananas, raw" over "Bananas, dehydrated, or banana powder".
 */
import type { TableFood } from './foodTable';

/** Words that say nothing about which food it is. */
const FILLER = new Set(['and', 'with', 'of', 'in', 'a', 'an', 'the', 'fresh', 'plain', 'style', 'or', 'from', 'type', 'pan', 'deep', 'stir', 'lightly', 'all', 'varieties', 'ns', 'as', 'to', 'eaten', 'prepared']);

/** How it was cooked. Any of them means "cooked"; the exact word is a preference, not a rule. */
const COOKED = new Set(['cooked', 'boiled', 'steamed', 'grilled', 'broiled', 'roasted', 'baked', 'fried', 'poached', 'scrambled', 'stewed', 'braised', 'microwaved', 'toasted', 'sauteed', 'simmered', 'heated']);
/** Words for the same way of cooking. */
const SAME_METHOD: Record<string, string> = { grilled: 'broiled' };

/** British words to the table's American ones. */
const SYNONYMS: Record<string, string[]> = {
  courgette: ['squash', 'summer', 'zucchini'],
  aubergine: ['eggplant'],
  prawn: ['shrimp'],
  mince: ['ground'],
  minced: ['ground'],
  yoghurt: ['yogurt'],
  rocket: ['arugula'],
  wholemeal: ['whole', 'wheat'],
  skimmed: ['skim'],
  beetroot: ['beet'],
  swede: ['rutabaga'],
  mangetout: ['snow', 'pea'],
  sultana: ['raisin'],
};

/** One word to the form the table uses: singular, American. */
function singular(word: string): string {
  if (word.length <= 3 || /(ss|us|is)$/.test(word)) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(ches|shes|xes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** A phrase's words, normalised; filler dropped. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.%]+/gu, ' ')
    .split(' ')
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .map(singular)
    .flatMap((w) => SYNONYMS[w] ?? [w])
    .filter((w) => !FILLER.has(w));
}

const stateOf = (tokens: string[]): 'raw' | 'cooked' | 'either' =>
  tokens.includes('raw') ? 'raw' : tokens.some((w) => COOKED.has(w)) ? 'cooked' : 'either';

export interface IndexedFood {
  food: TableFood;
  tokens: Set<string>;
  /** The words before the first comma: what the food is. */
  head: string[];
  state: 'raw' | 'cooked' | 'either';
  methods: Set<string>;
}

export interface FoodIndex {
  foods: IndexedFood[];
  /** Word → the foods containing it. */
  byWord: Map<string, number[]>;
}

export function indexFoods(foods: TableFood[]): FoodIndex {
  const indexed = foods.map((food) => {
    const tokens = words(food.name);
    return {
      food,
      tokens: new Set(tokens),
      head: words(food.name.split(',')[0]),
      state: stateOf(tokens),
      methods: new Set(tokens.filter((w) => COOKED.has(w)).map((w) => SAME_METHOD[w] ?? w)),
    };
  });
  const byWord = new Map<string, number[]>();
  indexed.forEach((entry, i) => {
    for (const word of entry.tokens) byWord.set(word, [...(byWord.get(word) ?? []), i]);
  });
  return { foods: indexed, byWord };
}

/**
 * The table's rows that could be this food, best first — every rule above
 * but the calorie check, which needs the portion (see `groundItem`).
 */
export function candidates(lookup: string, index: FoodIndex, limit = 3): TableFood[] {
  const tokens = words(lookup);
  const state = stateOf(tokens);
  const methods = new Set(tokens.filter((w) => COOKED.has(w)).map((w) => SAME_METHOD[w] ?? w));
  const required = [...new Set(tokens.filter((w) => w !== 'raw' && !COOKED.has(w)))];
  if (!required.length) return [];

  // Rows holding every word, found through the rarest word first.
  const postings = required.map((w) => index.byWord.get(w) ?? []).sort((a, b) => a.length - b.length);
  if (!postings[0].length) return [];
  const rest = postings.slice(1).map((p) => new Set(p));
  const said = new Set(tokens);

  const scored: { food: TableFood; score: number }[] = [];
  for (const i of postings[0]) {
    if (!rest.every((set) => set.has(i))) continue;
    const entry = index.foods[i];
    if (!entry.head.length || !entry.head.every((w) => said.has(w))) continue;
    if (state === 'raw' && entry.state === 'cooked') continue;
    if (state === 'cooked' && entry.state !== 'cooked') continue;

    const extra = [...entry.tokens].filter((w) => !said.has(w) && w !== 'raw' && !COOKED.has(w)).length;
    const sameMethod = [...methods].some((m) => entry.methods.has(m)) ? -1 : 0;
    // Not said either way: a row that does not say either is the plainest reading.
    const unsaid = state === 'either' && entry.state !== 'either' ? 0.5 : 0;
    scored.push({ food: entry.food, score: extra + sameMethod + unsaid + entry.food.name.length / 1000 });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.food);
}

/** Close enough to the AI's own reading of the portion to be the same food. */
export function plausible(aiCalories: number, tableCalories: number): boolean {
  if (Math.max(aiCalories, tableCalories) < 25) return true; // black coffee, a lettuce leaf
  if (aiCalories <= 0) return false;
  const ratio = tableCalories / aiCalories;
  return ratio >= 0.5 && ratio <= 2;
}
