import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Achievement, DayLog, FoodItem, MealEntry, Profile, Targets } from '../types';
import { computeTargets } from '../lib/nutrition';
import { isoDate, nowTime, slotForNow } from '../lib/date';

export const DEFAULT_PROFILE: Profile = {
  name: '',
  sex: 'female',
  age: 30,
  heightCm: 168,
  weightKg: 68,
  targetWeightKg: 63,
  activity: 'light',
  goal: 'lose',
  pace: 0.5,
  units: 'metric',
  onboarded: false,
};

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-meal', title: 'First bite', description: 'Log your very first meal', emoji: '🍽️' },
  { id: 'streak-3', title: 'Three in a row', description: 'Log meals three days running', emoji: '🔥' },
  { id: 'streak-7', title: 'Full week', description: 'Seven days of logging', emoji: '🗓️' },
  { id: 'streak-30', title: 'Squish regular', description: 'Thirty days of logging', emoji: '🏆' },
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
  /**
   * The nudge is cached against the situation it described, not just the day —
   * keyed on the date alone, the morning's "nothing logged yet" would still be
   * on screen after dinner.
   */
  lastCoachNote: { date: string; message: string; mealsLogged: number } | null;
  photoAnalyses: number;

  setProfile: (patch: Partial<Profile>) => void;
  completeOnboarding: (profile: Partial<Profile>) => void;
  setTargets: (patch: Partial<Targets>) => void;
  recalcTargets: () => void;

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
  rememberCoachNote: (message: string, mealsLogged: number) => void;
  resetAll: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

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

      rememberCoachNote: (message, mealsLogged) => set({ lastCoachNote: { date: isoDate(), message, mealsLogged } }),

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
        }),
    }),
    { name: 'squish-v1', version: 1 },
  ),
);
