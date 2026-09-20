import type { Activity, FoodItem, MacroKey, Nutrients, Profile, Targets } from '../types';

export const EMPTY: Nutrients = { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0, sodium: 0 };

/**
 * Adding two saturated-fat figures where either may be missing.
 *
 * Nought and "nobody said" are different answers, and treating the second as
 * the first would quietly tell someone their day was free of saturated fat
 * when all it was free of was data.
 */
export function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return round1((a ?? 0) + (b ?? 0));
}

const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

export const ACTIVITY_LABEL: Record<Activity, string> = {
  sedentary: 'Mostly sitting',
  light: 'Lightly active',
  moderate: 'Moderately active',
  active: 'Very active',
  athlete: 'Athlete',
};

export const MACRO_LABEL: Record<MacroKey, string> = {
  protein: 'Protein',
  carbs: 'Carbs',
  fat: 'Fat',
  fibre: 'Fibre',
};

/** kcal per gram — fibre is counted inside carbs, so it is not double-counted. */
export const MACRO_KCAL: Record<MacroKey, number> = { protein: 4, carbs: 4, fat: 9, fibre: 0 };

/** Mifflin-St Jeor basal metabolic rate. */
export function bmr(p: Pick<Profile, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  if (p.sex === 'male') return base + 5;
  if (p.sex === 'female') return base - 161;
  return base - 78;
}

/** What the textbook says, before anything is learned from their own logs. */
export function baseTdee(p: Profile): number {
  return bmr(p) * ACTIVITY_FACTOR[p.activity];
}

/**
 * What they actually burn, as best we know: the formula, tuned by whatever
 * their logs have shown. Clamped here as well as where it is set, so a
 * corrupted store cannot prescribe something daft.
 */
export function tdee(p: Profile): number {
  const factor = Math.min(1.15, Math.max(0.9, p.burnFactor ?? 1));
  return baseTdee(p) * factor;
}

/**
 * What the app means by "a glass". Water was counted in glasses without ever
 * saying how big one was, which made the target unreadable: people's glasses
 * run from 150 ml to a pint. 250 ml is the size the target was always
 * calculated against.
 */
export const GLASS_ML = 250;

/** Glasses as a volume, for the people who think in litres rather than count. */
export function waterVolume(glasses: number): string {
  const ml = glasses * GLASS_ML;
  return ml >= 1000 ? `${round1(ml / 1000)} L` : `${ml} ml`;
}

/**
 * How much of the day's energy should come from fat, and where "too much"
 * actually starts. They are deliberately two different numbers.
 *
 * Every body that publishes a figure treats total fat as a range, not a line:
 *
 *   WHO (2023)                 no more than 30% of energy, and "primarily
 *                              unsaturated"; saturated fat under 10%
 *   US (IOM / Dietary Guides)  20–35% of energy is the acceptable range
 *   UK (COMA, endorsed SACN)   no more than 35% of food energy — 78 g for a
 *                              woman on 2,000 kcal, 97 g for a man on 2,500
 *   EU label reference intake  70 g against 2,000 kcal, which is 31.5%
 *
 * Squish aimed at 28%, below all of them, and then treated that aim as a
 * ceiling — so a day built on olive oil, oily fish and nuts came back marked
 * down. The PREDIMED trial's Mediterranean arm, the one with the 30% drop in
 * cardiovascular events, prescribed four tablespoons of olive oil and 30 g of
 * nuts a day on top of everything else eaten: about 64 g of fat from the two
 * supplements alone. Under the old numbers that day was already over.
 *
 * So the target is 30% — WHO's figure, and near enough the EU label's — and
 * nothing is flagged until 35%, which is the point every one of the four above
 * agrees is too much.
 */
export const FAT_SHARE = 0.3;
export const FAT_MAX_SHARE = 0.35;

/** The top of the same body's acceptable range for carbohydrate. */
export const CARBS_MAX_SHARE = 0.65;

/**
 * Saturated fat, which is where the argument about fat actually is.
 *
 * WHO, the US guidelines and SACN all land on the same number: under 10% of
 * energy, with the rest of the fat unsaturated. Unlike total fat this one is a
 * line rather than a range, so the target is the limit. At 2,000 kcal it comes
 * to 22 g, which is what a British label's 20 g reference intake says too.
 */
export const SAT_FAT_MAX_SHARE = 0.1;

/**
 * Sugar has the same problem in miniature.
 *
 * The 10% of energy everyone quotes is WHO's figure for FREE sugars — the ones
 * added to food, plus honey and fruit juice. Squish counts total sugars,
 * because that is what a label states, what Open Food Facts stores and what a
 * photo can be judged on; nothing in the chain can tell the sugar in an apple
 * from the sugar in a biscuit. Holding total sugars to a free-sugars figure
 * marks down fruit and milk, which is not what the guideline says.
 *
 * So 10% stays as the aim, and the limit is the EU labelling reference intake
 * for total sugars: 90 g against 2,000 kcal, which is 18% of energy.
 */
export const SUGAR_SHARE = 0.1;
export const SUGAR_MAX_SHARE = 0.18;

/**
 * And the figure that 10% was always meant for.
 *
 * WHO's limit is on free sugars — added sugar, honey, syrups and the sugar in
 * fruit juice, which behaves the same way once the fruit has been liquidised.
 * The sugar in a whole apple or a glass of milk is not free, and no guideline
 * anywhere asks anyone to cut it down. Now that Squish counts them separately,
 * the 10% goes where it belongs: a real ceiling, at 50 g against 2,000 kcal.
 */
export const FREE_SUGAR_MAX_SHARE = 0.1;

/** Daily calorie + macro targets, Yazio-style: pace converted to a kcal delta. */
export function computeTargets(p: Profile): Targets {
  const maintenance = tdee(p);
  const paceDelta = (Math.min(Math.abs(p.pace), 1) * 7700) / 7; // 7700 kcal ≈ 1 kg
  let calories = maintenance;
  if (p.goal === 'lose') calories = maintenance - paceDelta;
  if (p.goal === 'gain') calories = maintenance + paceDelta;

  // Never prescribe below a safe floor.
  const floor = p.sex === 'male' ? 1500 : 1200;
  calories = Math.max(floor, Math.round(calories / 10) * 10);

  const proteinPerKg = p.goal === 'lose' ? 1.8 : p.goal === 'gain' ? 1.9 : 1.6;
  const protein = Math.round(proteinPerKg * Math.min(p.weightKg, p.targetWeightKg + 25));
  const fat = Math.round((calories * FAT_SHARE) / 9);
  const carbs = Math.max(60, Math.round((calories - protein * 4 - fat * 9) / 4));
  const fibre = Math.round((calories / 1000) * 14);

  return {
    calories,
    protein,
    carbs,
    fat,
    fibre,
    sugar: Math.round((calories * SUGAR_SHARE) / 4),
    freeSugar: Math.round((calories * FREE_SUGAR_MAX_SHARE) / 4),
    sodium: 2300,
    satFat: Math.round((calories * SAT_FAT_MAX_SHARE) / 9),
    fatMax: Math.round((calories * FAT_MAX_SHARE) / 9),
    carbsMax: Math.round((calories * CARBS_MAX_SHARE) / 4),
    sugarMax: Math.round((calories * SUGAR_MAX_SHARE) / 4),
    water: Math.max(6, Math.round((p.weightKg * 33) / GLASS_ML)),
    steps: p.activity === 'sedentary' ? 6000 : p.activity === 'light' ? 8000 : 10000,
  };
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  // Rounded as we go: gram totals are estimates, and float noise like 40.99999
  // has no business reaching the UI.
  return {
    calories: Math.round(a.calories + b.calories),
    protein: round1(a.protein + b.protein),
    carbs: round1(a.carbs + b.carbs),
    fat: round1(a.fat + b.fat),
    fibre: round1(a.fibre + b.fibre),
    satFat: addOptional(a.satFat, b.satFat),
    sugar: round1((a.sugar ?? 0) + (b.sugar ?? 0)),
    freeSugar: addOptional(a.freeSugar, b.freeSugar),
    sodium: Math.round((a.sodium ?? 0) + (b.sodium ?? 0)),
  };
}

export function sumNutrients(list: { nutrients: Nutrients }[]): Nutrients {
  return list.reduce((acc, x) => addNutrients(acc, x.nutrients), { ...EMPTY });
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  return {
    calories: Math.round(n.calories * factor),
    protein: round1(n.protein * factor),
    carbs: round1(n.carbs * factor),
    fat: round1(n.fat * factor),
    fibre: round1(n.fibre * factor),
    satFat: n.satFat === undefined ? undefined : round1(n.satFat * factor),
    sugar: round1((n.sugar ?? 0) * factor),
    freeSugar: n.freeSugar === undefined ? undefined : round1(n.freeSugar * factor),
    sodium: Math.round((n.sodium ?? 0) * factor),
  };
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Share of calories coming from each macro, as fractions that sum to 1. */
export function macroSplit(n: Nutrients): Record<'protein' | 'carbs' | 'fat', number> {
  const p = n.protein * 4;
  const c = n.carbs * 4;
  const f = n.fat * 9;
  const total = p + c + f;
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: p / total, carbs: c / total, fat: f / total };
}

/**
 * Diet-quality score, 0–100. Rewards protein and fibre density, penalises
 * heavy sugar, saturated-ish fat load and sodium. Used when the model does not
 * return one of its own.
 */
/**
 * What a meal scores when there is nothing to score it on.
 *
 * Diet quality is about the make-up of the energy you ate, so a glass of water
 * has none to judge. That is not the same as judging it badly — water was
 * coming out as "Heavy", the label meant for the worst meal of the week.
 */
export const UNSCORED = 0;

export function qualityScore(n: Nutrients): number {
  if (n.calories <= 0) return UNSCORED;
  const per1000 = (v: number) => (v / n.calories) * 1000;

  /*
   * Below about a hundred calories there is not enough on the plate for "per
   * 1000 kcal" to mean anything — it takes the splash of milk in a coffee and
   * scales it up into a day's worth of butter. So the marks against a food
   * fade out as the food gets smaller, rather than being extrapolated.
   *
   * Deliberately only the marks against. Over-crediting a bowl of spinach for
   * its fibre costs nobody anything; telling someone their coffee is a
   * saturated-fat problem is how a tracker loses your trust.
   */
  const solid = Math.min(1, n.calories / 100);

  let score = 52;
  score += Math.min(22, per1000(n.protein) * 0.42);
  score += Math.min(18, per1000(n.fibre) * 1.5);
  score -= Math.min(10, Math.max(0, per1000(n.sodium ?? 0) - 900) / 90) * solid;

  /*
   * Sugar.
   *
   * This used to dock up to 20 points for total sugars past 12 g per 1000 kcal
   * — 4.8% of energy, stricter than any guideline, applied to a figure no
   * guideline is about. An apple lost the full 20 and came out at 52; so did a
   * glass of milk, for its lactose.
   *
   * Free sugars carry it now, from 25 g per 1000 kcal, which is exactly the
   * 10% of energy WHO asks for. Whole fruit and plain milk cost nothing,
   * because they contain none.
   *
   * Where free sugars are unknown the old total-sugar rule stands in, for the
   * same reason it does for saturates: the wrong question beats no question.
   */
  if (n.freeSugar === undefined) {
    score -= Math.min(20, Math.max(0, per1000(n.sugar ?? 0) - 12) * 0.6) * solid;
  } else {
    score -= Math.min(24, Math.max(0, per1000(n.freeSugar) - 25) * 0.8) * solid;
  }

  /*
   * Fat.
   *
   * This used to be one line docking up to 14 points for total fat above 42 g
   * per 1000 kcal, which marked down salmon, avocado, olive oil and almonds —
   * the foods the evidence is most positive about. What the guidance actually
   * warns about is saturated fat: under 10% of energy, which is 11 g per 1000
   * kcal, with the rest unsaturated.
   *
   * So saturates carry the penalty where they are known — up to 24 points,
   * more than total fat ever cost, because this is the part the evidence is
   * actually about. Total fat keeps a light touch well past the 35% mark,
   * because a plate that is half oil is still worth a word whatever kind of
   * oil it is.
   *
   * Where saturates are unknown — a meal logged before Squish asked for them —
   * the old total-fat rule stands in. It is the wrong question, but it is
   * better than scoring blind.
   */
  if (n.satFat === undefined) {
    score -= Math.min(14, Math.max(0, per1000(n.fat) - 42) * 0.5) * solid;
  } else {
    score -= Math.min(24, Math.max(0, per1000(n.satFat) - 11) * 0.9) * solid;
    score -= Math.min(6, Math.max(0, per1000(n.fat) - 55) * 0.2) * solid;
  }

  return Math.max(1, Math.min(100, Math.round(score)));
}

export type Tone = 'good' | 'warn' | 'bad' | 'none';

export function scoreLabel(score: number): { label: string; tone: Tone } {
  if (score <= UNSCORED) return { label: 'Nothing to score', tone: 'none' };
  if (score >= 75) return { label: 'Brilliant', tone: 'good' };
  if (score >= 55) return { label: 'Balanced', tone: 'good' };
  if (score >= 38) return { label: 'So-so', tone: 'warn' };
  return { label: 'Heavy', tone: 'bad' };
}

/* ------------------------------------------------------------------ *
 * Going over.
 *
 * `qualityScore` judges what the food is made of, per 1000 kcal, and that is
 * the only fair question to ask of a single meal: a daily target cannot be
 * applied to one plate. But the day inherited the same blind spot, so 190 g of
 * fat against a 65 g target came back "Balanced" — the score had never been
 * shown the target. These flags are the missing half.
 *
 * Only the ceilings are checked. Protein and fibre over target is good news,
 * not a warning, and calories already have the ring.
 * ------------------------------------------------------------------ */

export type CeilingKey = 'carbs' | 'fat' | 'satFat' | 'sugar' | 'freeSugar' | 'sodium';

/** Checked worst-first, so the verdict names the biggest problem. */
export const CEILINGS: CeilingKey[] = ['satFat', 'freeSugar', 'fat', 'carbs', 'sugar', 'sodium'];

/**
 * How far past a limit counts as over.
 *
 * A hair over used to be swallowed by a quarter's tolerance, which made sense
 * while the limit was really a target. Now that the limits are the guidance's
 * own ceilings there is no allowance left to give — only enough slack that
 * rounding and estimation noise do not set it off. Half again past the limit
 * is loud.
 */
export const OVER = 1.05;
export const WAY_OVER = 1.5;

export interface OverTarget {
  key: CeilingKey;
  /** Stored units: grams for the macros, milligrams for sodium. */
  value: number;
  target: number;
  /** How many times the target — 2.9 for 190 g of fat against 65 g. */
  ratio: number;
  level: 'over' | 'way-over';
}

/**
 * Where "too much" starts for each ceiling.
 *
 * For fat and carbs this is deliberately not the target: those are the middle
 * of a range, and being above the middle of a range is not a fault. Sugar and
 * sodium have no such distinction — their targets were always limits.
 */
export function ceilingLimit(key: CeilingKey, t: Targets): number {
  // Zeroed on the You screen means "do not track this one", and a derived
  // limit has no business overriding that.
  if (!(t[key] ?? 0)) return 0;
  if (key === 'fat') return t.fatMax ?? Math.round((t.calories * FAT_MAX_SHARE) / 9);
  if (key === 'carbs') return t.carbsMax ?? Math.round((t.calories * CARBS_MAX_SHARE) / 4);
  if (key === 'sugar') return t.sugarMax ?? Math.round((t.calories * SUGAR_MAX_SHARE) / 4);
  // Free sugars and sodium are the ones whose targets always were limits.
  return t[key] ?? 0;
}

/** Every ceiling this lot of food is meaningfully over, worst first. */
export function overTargets(n: Nutrients, t: Targets): OverTarget[] {
  return CEILINGS.flatMap<OverTarget>((key) => {
    const target = ceilingLimit(key, t);
    const value = n[key] ?? 0;
    if (target <= 0 || value <= 0) return [];
    const ratio = value / target;
    if (ratio < OVER) return [];
    return [{ key, value, target, ratio, level: ratio >= WAY_OVER ? 'way-over' : 'over' }];
  }).sort((a, b) => b.ratio - a.ratio);
}

/** Is more of this a problem, or an achievement? */
export function isCeiling(key: string): key is CeilingKey {
  return (CEILINGS as string[]).includes(key);
}

export const CEILING_LABEL: Record<CeilingKey, string> = {
  satFat: 'Saturates',
  freeSugar: 'Free sugars',
  fat: 'Fat',
  carbs: 'Carbs',
  sugar: 'Sugar',
  sodium: 'Salt',
};

/**
 * The verdict on a whole day: the quality score, but no longer allowed to call
 * a day balanced while something on it is half again over its target. The
 * number is left alone — it still means what it always meant — and the words
 * beside it stop contradicting the bars underneath.
 */
export function dayVerdict(
  score: number,
  n: Nutrients,
  t: Targets,
): { label: string; tone: Tone; over: OverTarget[] } {
  const over = overTargets(n, t);
  const worst = over.find((o) => o.level === 'way-over');
  if (score > UNSCORED && worst) {
    return { label: `Over on ${CEILING_LABEL[worst.key].toLowerCase()}`, tone: 'bad', over };
  }
  return { ...scoreLabel(score), over };
}

/**
 * What going well over a ceiling costs the day's score.
 *
 * The composition score already leans on fat, sugar and salt *density*, but
 * density is not amount: eat 2,600 kcal and the fat can be a perfectly
 * ordinary share of it while still being three times what the day had room
 * for. That gap belongs to the day, not to any meal in it, so it is charged
 * here and nowhere else — a meal's own score never sees a daily target.
 *
 * The penalty ramps from the point a flag first appears rather than switching
 * on at half-over, so there is no cliff: a day that creeps over loses a point
 * or two, and a day at three times its fat target loses the thirty that
 * separate a good day from a poor one.
 */
export const PENALTY_PER_X = 22;
export const MAX_PENALTY_EACH = 30;
export const MAX_PENALTY = 35;

export function overPenalty(over: OverTarget[]): number {
  const total = over.reduce(
    (sum, o) => sum + Math.min(MAX_PENALTY_EACH, (o.ratio - OVER) * PENALTY_PER_X),
    0,
  );
  return Math.min(MAX_PENALTY, Math.round(total));
}

/**
 * How far over, in words, to sit mid-sentence: "Fat 190 g — nearly 3× your
 * 65 g target." A round multiple lands where "2.9×" does not, and at the small
 * end a percentage is the honest way to put it.
 */
export function overPhrase(o: OverTarget): string {
  if (o.ratio < 1.9) return `${Math.round((o.ratio - 1) * 100)}% over`;
  const whole = Math.round(o.ratio);
  if (Math.abs(o.ratio - whole) < 0.03) return `${whole}×`;
  return o.ratio > whole ? `over ${whole}×` : `nearly ${whole}×`;
}

export function itemsTotal(items: FoodItem[]): Nutrients {
  return sumNutrients(items);
}

export function kcalOf(n: Nutrients): number {
  return Math.round(n.protein * 4 + n.carbs * 4 + n.fat * 9);
}

/** Estimates grams remaining before a target, never negative. */
export function remaining(target: number, current: number): number {
  return Math.max(0, Math.round(target - current));
}

export function pct(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(1.5, current / target);
}
