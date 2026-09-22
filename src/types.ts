export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type Mood =
  | 'excited'
  | 'nomnom'
  | 'calm'
  | 'sleepy'
  | 'proud'
  | 'cheering'
  | 'thinking';

/** Macro keys in their fixed display order — the chart palette is keyed to this order. */
export const MACROS = ['protein', 'carbs', 'fat', 'fibre'] as const;
export type MacroKey = (typeof MACROS)[number];

export interface Nutrients {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  /**
   * Saturated fat in grams, counted inside `fat`.
   *
   * Undefined means nobody said, not nought — meals logged before Squish
   * asked for it, and anything from a source that does not carry it. The
   * difference matters: a day of unknowns must not read as a day of none.
   */
  satFat?: number;
  sugar?: number;
  /**
   * Free sugars in grams, counted inside `sugar`: the ones added to food, plus
   * honey, syrups and the sugar in fruit juice. The sugar in a whole apple or
   * a glass of milk is not free, and the guidelines do not ask anyone to cut
   * it down.
   *
   * Undefined means nobody said, the same as `satFat`.
   */
  freeSugar?: number;
  sodium?: number;
  /**
   * Vitamins and minerals, where anything knows them. Absent means nobody
   * said, the same as `satFat` — and for these that is the common case, so
   * anything showing them has to say what it is missing.
   */
  micros?: Micros;
}

/**
 * The six worth tracking.
 *
 * Not a hundred. A photo cannot tell you how much selenium was in the soil the
 * carrot grew in, and a list of a hundred numbers each carrying that much doubt
 * is a wall of false precision. These six earn their place because British
 * intakes genuinely fall short of them and because food composition tables
 * agree about them: iron (a fifth of young women in the UK are below the lower
 * threshold), calcium and vitamin D for bone, B12 for anyone eating little or
 * no meat, folate before and during pregnancy, and vitamin C.
 */
export const MICROS = ['iron', 'calcium', 'vitaminD', 'vitaminB12', 'folate', 'vitaminC'] as const;
export type MicroKey = (typeof MICROS)[number];
export type Micros = Partial<Record<MicroKey, number>>;

export interface FoodItem {
  id: string;
  name: string;
  emoji?: string;
  /**
   * Ultra-processed: industrially formulated from refined substances and
   * additives rather than cooked from food — crisps, confectionery, soft
   * drinks, mass-produced pastries, formulated powders. NOVA group 4.
   *
   * It is the one thing a nutrient panel cannot see, which is why it is
   * carried separately. Undefined means nobody classified it.
   */
  ultraProcessed?: boolean;
  /** What the portion was, in words: "1 bowl". The weight is shown from `grams`. */
  portion: string;
  grams?: number;
  /** Measured by volume rather than weight — a drink, a soup, a sauce. */
  liquid?: boolean;
  nutrients: Nutrients;
}

export interface MealEntry {
  id: string;
  /** ISO date, yyyy-mm-dd. */
  date: string;
  time: string;
  slot: MealSlot;
  title: string;
  items: FoodItem[];
  nutrients: Nutrients;
  /** 0–100 diet-quality score. */
  score: number;
  note?: string;
  coachNote?: string;
  /**
   * A thumbnail, a few kilobytes, not the photograph.
   *
   * The full-size one lives in IndexedDB under this meal's id — see
   * lib/photos.ts for why. This is what the 46px row in the diary shows, what
   * survives a restore, and what anything can rely on being present without
   * waiting.
   */
  photo?: string;
  source: 'photo' | 'describe' | 'search' | 'manual' | 'favourite';
  aiConfidence?: 'high' | 'medium' | 'low';
}

export interface DayLog {
  date: string;
  water: number;
  steps: number;
  weightKg?: number;
  moodNote?: string;
}

export type Goal = 'lose' | 'maintain' | 'gain';
export type Sex = 'female' | 'male' | 'other';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'athlete';

export interface Profile {
  name: string;
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  activity: Activity;
  goal: Goal;
  /** kg per week, positive magnitude. */
  pace: number;
  units: 'metric' | 'imperial';
  onboarded: boolean;
  /**
   * What their own logs say about their metabolism, as a multiple of the
   * textbook estimate. 1 until there is enough data to say otherwise, and
   * only ever changed with their say-so.
   */
  burnFactor?: number;
  /**
   * The size of the crockery they actually eat off, in centimetres across and
   * millilitres respectively.
   *
   * Most people eat most of their meals off the same two or three things, and
   * a plate of known width is a ruler lying in the photograph. It is the
   * nearest a web app gets to the depth sensor a phone would use.
   */
  plateCm?: number;
  bowlMl?: number;
}

export interface Targets extends Nutrients {
  water: number;
  steps: number;
  /**
   * Where too much starts, for the nutrients whose target is the middle of a
   * range rather than a line. Optional: a store written before these existed
   * falls back to working them out from the calorie target.
   */
  fatMax?: number;
  carbsMax?: number;
  sugarMax?: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  emoji: string;
  unlockedOn?: string;
}

export interface AnalysisResult {
  title: string;
  slot?: MealSlot;
  items: FoodItem[];
  nutrients: Nutrients;
  score: number;
  coachNote: string;
  confidence: 'high' | 'medium' | 'low';
  /** True when the local estimator answered instead of Claude. */
  offline?: boolean;
}

/**
 * A meal on its way into the diary: analysed, being checked, not yet saved.
 *
 * It lives here rather than beside the router because the store keeps one of
 * these now. A meal that has been photographed and corrected is twenty
 * seconds of somebody's attention, and losing it to a back gesture or a
 * browser tab reclaimed in the background was losing exactly that.
 */
export interface Draft {
  analysis: AnalysisResult;
  /** The thumbnail, as it will be stored on the meal. */
  photo?: string;
  /**
   * The display-size photo, held only until the meal is saved.
   *
   * Deliberately not persisted with the rest of the draft: it is a fifth of a
   * megabyte, and the draft is written to localStorage on every keystroke in
   * the title field. The thumbnail above is what a recovered draft shows.
   */
  photoFull?: string;
  slot: MealSlot;
  date: string;
  /** Whatever they had typed in the note field when it was last kept. */
  note?: string;
  /** Set when editing a meal that is already in the diary. */
  editingId?: string;
}

/**
 * Where the app is. Kept here rather than beside the router so a component can
 * name a destination without importing the thing that renders it.
 */
export type Route =
  | { name: 'home' }
  | { name: 'meals' }
  | { name: 'insights' }
  | { name: 'you' }
  /** `shot` opens straight into that mode — a barcode is two taps, not three. */
  | { name: 'capture'; slot?: MealSlot; date?: string; shot?: 'plate' | 'label' | 'barcode' }
  | { name: 'add'; slot?: MealSlot; date?: string; tab?: 'search' | 'describe' | 'recipe' | 'favourites' }
  | { name: 'ask' }
  | { name: 'review'; draft: Draft };
