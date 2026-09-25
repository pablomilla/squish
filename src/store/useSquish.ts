import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Achievement, DayLog, Draft, FoodItem, MealEntry, Profile, Targets } from '../types';
import {
  CARBS_MAX_SHARE,
  FAT_MAX_SHARE,
  FAT_SHARE,
  FREE_SUGAR_MAX_SHARE,
  SAT_FAT_MAX_SHARE,
  SUGAR_MAX_SHARE,
  computeTargets,
  microTargets,
} from '../lib/nutrition';
import { STARTING_WEIGHTS } from '../lib/units';
import { DEFAULT_LOOK } from '../lib/looks';
import type { Outfit } from '../lib/outfit';
import type { ShareDecor } from '../lib/shareDecor';
import { newNote, type NutritionistNote } from '../lib/nutritionist-tools';
import { isoDate, nowTime, slotForNow, type PartOfDay } from '../lib/date';

/**
 * Squish is for adults. It sets calorie targets and gives diet feedback, and
 * its energy formula is one for grown bodies — none of which is right for
 * somebody still growing. See docs/privacy.md, "Age".
 */
export const MIN_AGE = 18;

export const DEFAULT_PROFILE: Profile = {
  name: '',
  sex: 'female',
  age: 30,
  heightCm: 168,
  weightKg: STARTING_WEIGHTS.metric.weightKg,
  targetWeightKg: STARTING_WEIGHTS.metric.targetWeightKg,
  activity: 'light',
  goal: 'lose',
  pace: 0.5,
  units: 'metric',
  onboarded: false,
  // No plate size until somebody measures one. See clearAssumedCrockery.
};

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-meal', title: 'First bite', description: 'Log your very first meal', emoji: '🍽️' },
  { id: 'streak-3', title: 'Three in a row', description: 'Log meals three days running', emoji: '🔥' },
  { id: 'streak-7', title: 'Full week', description: 'Seven days of logging', emoji: '🗓️' },
  { id: 'streak-14', title: 'Fortnight', description: 'Two weeks of logging', emoji: '🌿' },
  { id: 'streak-30', title: 'Squish regular', description: 'Thirty days of logging', emoji: '🏆' },
  { id: 'streak-100', title: 'Century', description: 'A hundred days of logging', emoji: '💯' },
  { id: 'streak-365', title: 'A whole year', description: 'A year of logging', emoji: '🎂' },
  { id: 'first-share', title: 'Show and tell', description: 'Share a progress card', emoji: '📣' },
  { id: 'squad', title: 'Squad', description: 'A friend you invited got going', emoji: '🤝' },
  { id: 'protein-hit', title: 'Protein pro', description: 'Hit your protein target in a day', emoji: '💪' },
  { id: 'fibre-hit', title: 'Fibre friend', description: 'Hit your fibre target in a day', emoji: '🥦' },
  { id: 'hydrated', title: 'Well watered', description: 'Reach your water goal', emoji: '💧' },
  { id: 'balanced-day', title: 'Balanced day', description: 'Finish a day scoring 75+', emoji: '⭐' },
  { id: 'photo-10', title: 'Snap happy', description: 'Analyse ten meals from photos', emoji: '📸' },
];

interface SquishState {
  profile: Profile;
  targets: Targets;
  meals: MealEntry[];
  days: Record<string, DayLog>;
  favourites: FoodItem[];
  unlocked: Record<string, string>;
  theme: 'light' | 'dark' | 'system';
  /** "The protein of 3 eggs" on meals and the day. On unless turned off in You → Appearance. */
  comparisons: boolean;
  /** Which colourway Squish is wearing. Earned, never bought. */
  look: string;
  /** What Squish has on, one item per slot. Checked against what they may wear at every render. */
  outfit: Outfit;
  /** Which Home scene is behind Squish; empty for the plain card. Checked at every render. */
  scene: string;
  /** The frame and up to two stickers on a share card. Checked when the card is drawn. */
  shareDecor: ShareDecor;
  /**
   * When to nudge, and whether to at all. The times live here rather than only
   * on the server so the screen can show them without a round trip, and so
   * they survive a server that has forgotten its subscriptions.
   */
  reminders: { on: boolean; breakfast: string; lunch: string; dinner: string };
  /**
   * What the nutritionist has chosen to remember: an allergy, a dislike, a
   * race being trained for. It writes these itself and they are shown on the
   * You screen, where any of them can be deleted.
   */
  nutritionistNotes: NutritionistNote[];
  /**
   * A meal that has been analysed and is being checked, held until it is
   * either saved or thrown away.
   *
   * It is kept here, in the persisted store, rather than in the screen's own
   * state, because the ways a meal was being lost were all ways that take the
   * screen with them: the back gesture, a tab the phone reclaims while you
   * are reading a message, a browser closed on the way to the kitchen. None
   * of those is a decision to discard anything.
   *
   * Only ever a new meal. Abandoning an edit loses nothing — the meal it was
   * editing is still in the diary.
   */
  pendingMeal: Draft | null;
  /**
   * The nudge is cached against the situation it described, not just the day —
   * keyed on the date alone, the morning's "nothing logged yet" would still be
   * on screen after dinner. The part of the day counts too: with nothing
   * logged, "Morning, Paul!" would otherwise still be there at ten at night.
   */
  lastCoachNote: { date: string; message: string; mealsLogged: number; part?: PartOfDay } | null;
  photoAnalyses: number;

  setProfile: (patch: Partial<Profile>) => void;
  completeOnboarding: (profile: Partial<Profile>) => void;
  setTargets: (patch: Partial<Targets>) => void;
  recalcTargets: () => void;
  /** Accept what the logs say about their metabolism, and redo the plan on it. */
  applyBurnFactor: (factor: number) => void;

  addMeal: (meal: Omit<MealEntry, 'id' | 'date' | 'time'> & Partial<Pick<MealEntry, 'id' | 'date' | 'time'>>) => MealEntry;
  updateMeal: (id: string, patch: Partial<MealEntry>) => void;
  removeMeal: (id: string) => void;

  day: (date: string) => DayLog;
  setWater: (date: string, glasses: number) => void;
  setSteps: (date: string, steps: number) => void;
  setWeight: (date: string, weightKg: number) => void;

  toggleFavourite: (item: FoodItem) => void;
  isFavourite: (name: string) => boolean;

  unlock: (id: string) => void;
  countPhotoAnalysis: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setComparisons: (on: boolean) => void;
  setLook: (look: string) => void;
  setOutfit: (outfit: Outfit) => void;
  setScene: (scene: string) => void;
  setShareDecor: (decor: ShareDecor) => void;
  setReminders: (patch: Partial<SquishState['reminders']>) => void;
  setPendingMeal: (draft: Draft | null) => void;
  rememberNote: (note: string) => NutritionistNote;
  forgetNote: (id: string) => boolean;
  rememberCoachNote: (message: string, mealsLogged: number, part: PartOfDay) => void;
  resetAll: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Store v1 -> v2: the fat target moved from 28% of energy to 30%, and stopped
 * doubling as the ceiling.
 *
 * Only targets that still carry the old formula's answer are touched. Anyone
 * who set their own fat number on the You screen meant it, and keeps it —
 * which is why this checks rather than simply recomputing.
 */
export function raiseFatTarget(state: unknown, from: number): unknown {
  if (from >= 2 || !state || typeof state !== 'object') return state;
  const s = state as { targets?: Targets };
  const t = s.targets;
  if (!t?.calories) return state;

  const wasAutomatic = t.fat === Math.round((t.calories * 0.28) / 9);
  if (!wasAutomatic) return state;

  const fat = Math.round((t.calories * FAT_SHARE) / 9);
  return {
    ...s,
    targets: {
      ...t,
      fat,
      // Carbohydrate is the remainder, so it has to move with it.
      carbs: Math.max(60, Math.round((t.calories - t.protein * 4 - fat * 9) / 4)),
      fatMax: Math.round((t.calories * FAT_MAX_SHARE) / 9),
      carbsMax: Math.round((t.calories * CARBS_MAX_SHARE) / 4),
      sugarMax: Math.round((t.calories * SUGAR_MAX_SHARE) / 4),
    },
  };
}

/**
 * Store v2 -> v3: stop assuming everybody eats off a 27 cm plate.
 *
 * The plate size is sent to the model as a scale reference, and the payoff is
 * not symmetric. A correct one is real information. An absent one is neutral —
 * the model falls back on what a normal portion looks like. A wrong one is
 * worse than either, because the food is scaled by the ratio: tell it 27 cm
 * about a 20 cm plate and the portion comes out getting on for twice the size.
 *
 * Shipping a default put every new user in the third case, which was the one
 * mistake worth not making. Only the exact pair that default wrote is cleared;
 * anybody who has since measured their own keeps it.
 */
export function clearAssumedCrockery(state: unknown, from: number): unknown {
  if (from >= 3 || !state || typeof state !== 'object') return state;
  const s = state as { profile?: Profile };
  if (s.profile?.plateCm !== 27 || s.profile?.bowlMl !== 400) return state;

  const { plateCm: _plate, bowlMl: _bowl, ...profile } = s.profile;
  return { ...s, profile };
}

/**
 * Store v3 -> v4: give existing targets their vitamin and mineral intakes.
 *
 * `computeTargets` gained them, but persisted targets never ran through it
 * again — so for anyone who had used Squish before, `targets.micros` stayed
 * undefined, every row of the vitamins card filtered itself out, and the card
 * rendered nothing however much spinach went in. The food had the figures all
 * along; there was simply nothing to measure them against.
 *
 * Safe to fill in unasked: there is no screen for editing a micronutrient
 * target, so there is no deliberate choice here to overwrite.
 */
export function addMicroTargets(state: unknown, from: number): unknown {
  if (from >= 4 || !state || typeof state !== 'object') return state;
  const s = state as { profile?: Profile; targets?: Targets };
  if (!s.targets || s.targets.micros || !s.profile) return state;

  return { ...s, targets: { ...s.targets, micros: microTargets(s.profile) } };
}

/**
 * Store v4 -> v5: the saturated fat and free sugar ceilings, for the same
 * reason and with the same consequence as the micronutrients above.
 *
 * Both are limits with no computed fallback in `ceilingLimit` — a zeroed one
 * means "stop counting this" — so an absent one reads as switched off. On a
 * store from before the features that meant the Saturates and Free sugars
 * tiles never rendered, and, worse, that neither could ever be flagged: a day
 * carrying 60 g of saturates against a 21 g limit raised nothing at all and
 * reported itself as over on total sugar instead.
 *
 * Filled in only where absent, so anyone who has set their own keeps it.
 */
export function addCeilingTargets(state: unknown, from: number): unknown {
  if (from >= 5 || !state || typeof state !== 'object') return state;
  const s = state as { targets?: Targets };
  const t = s.targets;
  if (!t?.calories) return state;
  if (t.satFat !== undefined && t.freeSugar !== undefined) return state;

  return {
    ...s,
    targets: {
      ...t,
      satFat: t.satFat ?? Math.round((t.calories * SAT_FAT_MAX_SHARE) / 9),
      freeSugar: t.freeSugar ?? Math.round((t.calories * FREE_SUGAR_MAX_SHARE) / 4),
    },
  };
}

/** Every migration, oldest first. */
export function migrate(state: unknown, from: number): unknown {
  let out: unknown = state;
  for (const step of [raiseFatTarget, clearAssumedCrockery, addMicroTargets, addCeilingTargets]) {
    out = step(out, from);
  }
  return out;
}

export const emptyDay = (date: string): DayLog => ({ date, water: 0, steps: 0 });

export const useSquish = create<SquishState>()(
  persist(
    (set, get) => ({
      profile: DEFAULT_PROFILE,
      targets: computeTargets(DEFAULT_PROFILE),
      meals: [],
      days: {},
      favourites: [],
      unlocked: {},
      theme: 'system',
      comparisons: true,
      look: DEFAULT_LOOK,
      outfit: {},
      scene: '',
      shareDecor: { frame: '', stickers: [] },
      // Off until asked for. A notification permission prompt nobody invited
      // is the fastest way to be told no for ever.
      reminders: { on: false, breakfast: '08:00', lunch: '12:30', dinner: '19:00' },
      nutritionistNotes: [],
      pendingMeal: null,
      lastCoachNote: null,
      photoAnalyses: 0,

      setProfile: (patch) => {
        const profile = { ...get().profile, ...patch };
        set({ profile, targets: computeTargets(profile) });
      },

      completeOnboarding: (patch) => {
        const profile = { ...get().profile, ...patch, onboarded: true };
        set({ profile, targets: computeTargets(profile) });
        if (profile.weightKg) get().setWeight(isoDate(), profile.weightKg);
      },

      setTargets: (patch) => set({ targets: { ...get().targets, ...patch } }),
      recalcTargets: () => set({ targets: computeTargets(get().profile) }),

      applyBurnFactor: (factor) => {
        const profile = { ...get().profile, burnFactor: factor };
        set({ profile, targets: computeTargets(profile) });
      },

      addMeal: (meal) => {
        const entry: MealEntry = {
          id: meal.id ?? uid(),
          date: meal.date ?? isoDate(),
          time: meal.time ?? nowTime(),
          slot: meal.slot ?? slotForNow(),
          title: meal.title,
          items: meal.items,
          nutrients: meal.nutrients,
          score: meal.score,
          note: meal.note,
          coachNote: meal.coachNote,
          photo: meal.photo,
          source: meal.source,
          aiConfidence: meal.aiConfidence,
        };
        set({ meals: [...get().meals, entry] });
        get().unlock('first-meal');
        return entry;
      },

      updateMeal: (id, patch) =>
        set({ meals: get().meals.map((m) => (m.id === id ? { ...m, ...patch } : m)) }),

      removeMeal: (id) => set({ meals: get().meals.filter((m) => m.id !== id) }),

      day: (date) => get().days[date] ?? emptyDay(date),

      setWater: (date, glasses) => {
        const water = Math.max(0, Math.min(24, glasses));
        set({ days: { ...get().days, [date]: { ...get().day(date), water } } });
        if (water >= get().targets.water) get().unlock('hydrated');
      },

      setSteps: (date, steps) =>
        set({ days: { ...get().days, [date]: { ...get().day(date), steps: Math.max(0, Math.round(steps)) } } }),

      setWeight: (date, weightKg) => {
        set({ days: { ...get().days, [date]: { ...get().day(date), weightKg } } });
        if (date === isoDate()) {
          const profile = { ...get().profile, weightKg };
          set({ profile, targets: computeTargets(profile) });
        }
      },

      toggleFavourite: (item) => {
        const favourites = get().favourites;
        const existing = favourites.find((f) => f.name.toLowerCase() === item.name.toLowerCase());
        set({
          favourites: existing
            ? favourites.filter((f) => f.id !== existing.id)
            : [{ ...item, id: uid() }, ...favourites].slice(0, 40),
        });
      },

      isFavourite: (name) => get().favourites.some((f) => f.name.toLowerCase() === name.toLowerCase()),

      unlock: (id) => {
        if (get().unlocked[id]) return;
        set({ unlocked: { ...get().unlocked, [id]: isoDate() } });
      },

      countPhotoAnalysis: () => {
        const photoAnalyses = get().photoAnalyses + 1;
        set({ photoAnalyses });
        if (photoAnalyses >= 10) get().unlock('photo-10');
      },

      setTheme: (theme) => set({ theme }),
      setComparisons: (comparisons) => set({ comparisons }),
      setLook: (look) => set({ look }),
      setOutfit: (outfit) => set({ outfit }),
      setScene: (scene) => set({ scene }),
      setShareDecor: (shareDecor) => set({ shareDecor }),
      setReminders: (patch) => set({ reminders: { ...get().reminders, ...patch } }),

      setPendingMeal: (pendingMeal) => set({ pendingMeal }),

      rememberNote: (note) => {
        const saved = newNote(note);
        set({ nutritionistNotes: [...get().nutritionistNotes, saved] });
        return saved;
      },

      forgetNote: (id) => {
        const kept = get().nutritionistNotes.filter((n) => n.id !== id);
        if (kept.length === get().nutritionistNotes.length) return false;
        set({ nutritionistNotes: kept });
        return true;
      },

      rememberCoachNote: (message, mealsLogged, part) => set({ lastCoachNote: { date: isoDate(), message, mealsLogged, part } }),

      resetAll: () =>
        set({
          profile: DEFAULT_PROFILE,
          targets: computeTargets(DEFAULT_PROFILE),
          meals: [],
          days: {},
          favourites: [],
          unlocked: {},
          lastCoachNote: null,
          photoAnalyses: 0,
          nutritionistNotes: [],
          pendingMeal: null,
          look: DEFAULT_LOOK,
          outfit: {},
          scene: '',
          shareDecor: { frame: '', stickers: [] },
          comparisons: true,
        }),
    }),
    {
      name: 'squish-v1',
      version: 5,
      migrate,
      /*
       * A safety net under the migrations, not a replacement for them.
       *
       * Persist merges the saved state over the fresh one, but only one level
       * deep: a missing top-level key like `reminders` is filled from the
       * defaults, while `profile` and `targets` are taken wholesale and any
       * key added since is simply absent. That is how three target fields came
       * to be silently missing, and it is worse than it sounds for `profile` —
       * one absent required field puts NaN through the BMR formula and into
       * ten target values, which no fallback anywhere can undo.
       *
       * `targets` is deliberately NOT merged this way, and trying it is what
       * showed why. Targets belong to a person: filling a gap from the default
       * profile's targets gave a store on 1,900 kcal a fat ceiling of 54 g,
       * which belongs to somebody else entirely — and worse, having a wrong
       * value present stopped `ceilingLimit` working the right one out from
       * their own calories. A plausible number is more dangerous than a
       * missing one when something downstream knows how to derive it.
       *
       * So targets are left to migrations, which compute them per person, and
       * to the guard test that fails when a new one arrives without a step.
       */
      /*
       * What is written to localStorage, which is not quite what is in memory.
       *
       * A draft's full-size photo is a fifth of a megabyte and the draft is
       * saved on every keystroke in the title field. Persisting it would put
       * that through JSON.stringify on each one and spend a twentieth of the
       * whole storage budget on a meal not yet saved. The thumbnail on the
       * draft is what a recovered draft shows, which is what it is for.
       */
      partialize: (state) => ({
        ...state,
        pendingMeal: state.pendingMeal ? { ...state.pendingMeal, photoFull: undefined } : null,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SquishState>;
        return {
          ...current,
          ...saved,
          profile: { ...current.profile, ...saved.profile },
          reminders: { ...current.reminders, ...saved.reminders },
        };
      },
    },
  ),
);
