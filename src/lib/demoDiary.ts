/**
 * What the website's screenshots show (scripts/site-shots.ts): a believable
 * fortnight of meals, a week Squish planned, and one recipe with its steps.
 * Nobody's actual diary — everything here is made up.
 *
 * The meals are words a person would have typed, so the app never translates
 * them. They are marked for translation here instead, which puts them in each
 * language's pack with everything else; the screenshot script fills the diary
 * in the language it is photographing, so a Spanish screenshot shows a Spanish
 * breakfast. Nothing in the app itself uses this file.
 */
import type { CookSteps, DayLog, FoodItem, MealEntry, MealSlot, Profile } from '../types';
import type { StepAction } from './cooking';
import { addDays } from './date';
import { msg } from './i18n';
import { SQUISH_PLAN_NOTE } from './planner';

type Dish = [title: string, calories: number, protein: number, carbs: number, fat: number, fibre: number, score: number];

const MENU: Record<MealSlot, Dish[]> = {
  breakfast: [
    [msg('Porridge with blueberries and honey'), 380, 13, 62, 8, 7, 84],
    [msg('Greek yoghurt, granola and raspberries'), 340, 20, 38, 11, 5, 80],
    [msg('Scrambled eggs on sourdough'), 420, 24, 32, 21, 3, 72],
    [msg('Banana and peanut butter toast'), 390, 12, 48, 16, 6, 74],
  ],
  lunch: [
    [msg('Chicken, avocado and quinoa salad'), 520, 38, 36, 22, 9, 88],
    [msg('Lentil and tomato soup with a roll'), 460, 22, 64, 9, 13, 86],
    [msg('Tuna and sweetcorn jacket potato'), 540, 34, 70, 11, 7, 76],
    [msg('Falafel wrap with houmous'), 580, 19, 68, 24, 10, 70],
  ],
  dinner: [
    [msg('Salmon, new potatoes and green beans'), 610, 42, 44, 26, 7, 90],
    [msg('Vegetable stir-fry with tofu and rice'), 560, 26, 72, 16, 8, 84],
    [msg('Spaghetti bolognese'), 690, 36, 82, 20, 7, 68],
    [msg('Chickpea and spinach curry with rice'), 620, 21, 90, 17, 14, 82],
  ],
  snack: [
    [msg('Apple and a handful of almonds'), 190, 5, 20, 11, 5, 82],
    [msg('Oat flapjack'), 240, 4, 30, 12, 3, 48],
    [msg('Houmous and carrot sticks'), 160, 6, 14, 9, 6, 86],
  ],
};

/** The week Squish planned, from today's dinner on. */
const PLANNED: [day: number, slot: MealSlot, dish: Dish][] = [
  [0, 'dinner', [msg('Lemon and herb salmon traybake'), 590, 41, 46, 24, 8, 90]],
  [1, 'breakfast', [msg('Overnight oats with berries'), 360, 16, 54, 9, 8, 86]],
  [1, 'lunch', [msg('Chicken and roasted vegetable wrap'), 510, 36, 52, 15, 9, 82]],
  [1, 'dinner', [msg('Turkey chilli with brown rice'), 620, 42, 70, 15, 13, 86]],
  [2, 'breakfast', [msg('Spinach and feta omelette'), 340, 26, 6, 23, 3, 80]],
  [2, 'lunch', [msg('Lentil and tomato soup with a roll'), 460, 22, 64, 9, 13, 86]],
  [2, 'dinner', [msg('Prawn and vegetable noodles'), 540, 34, 66, 13, 7, 80]],
];

/** How the traybake is made, with what each step's picture shows. */
const RECIPE: { minutes: number; steps: [text: string, action: StepAction, minutes?: number][]; tip: string } = {
  minutes: 35,
  steps: [
    [msg('Heat the oven to 200°C. Halve the new potatoes and slice the lemon.'), 'prep'],
    [msg('Toss the potatoes with the oil, salt and pepper on a tray and roast for 15 minutes.'), 'bake', 15],
    [msg('Add the salmon and green beans, top with lemon and herbs, and roast for 12 minutes more.'), 'bake', 12],
    [msg('Plate it up with a squeeze of lemon.'), 'serve'],
  ],
  tip: msg('Swap the green beans for asparagus or broccoli — whatever is in season.'),
};

/** What goes into it, for one: name, emoji, portion, grams, kcal, protein, carbs, fat, fibre. */
const INGREDIENTS: [string, string, string, number, number, number, number, number, number][] = [
  [msg('Salmon fillet'), '🐟', msg('1 fillet'), 130, 270, 28, 0, 17, 0],
  [msg('New potatoes'), '🥔', msg('6 small'), 200, 150, 4, 34, 0, 3],
  [msg('Green beans'), '🫛', msg('A handful'), 100, 31, 2, 7, 0, 3],
  [msg('Lemon'), '🍋', msg('Half'), 40, 12, 0, 4, 0, 1],
  [msg('Olive oil'), '🫒', msg('1 tablespoon'), 14, 124, 0, 0, 14, 0],
];

const TIMES: Record<MealSlot, string> = { breakfast: '08:05', lunch: '12:50', snack: '15:40', dinner: '18:45' };

const nutrients = ([, calories, protein, carbs, fat, fibre]: Dish) => ({
  calories,
  protein,
  carbs,
  fat,
  fibre,
  // Rough but plausible: sugar from carbs, salt as sodium in mg.
  sugar: Math.round(carbs * 0.18),
  freeSugar: Math.round(carbs * 0.08),
  satFat: Math.round(fat * 0.3),
  sodium: Math.round(calories * 0.9),
});

/**
 * The persisted state of a phone with a fortnight in it, as of `today`, in the
 * words `say` gives back (a language pack's translation, or the English).
 */
export function demoState(today: string, say: (english: string) => string, profile: Partial<Profile> = {}) {
  const meals: MealEntry[] = [];
  for (let day = 13; day >= 0; day--) {
    const date = addDays(today, -day);
    const slots: MealSlot[] = day === 0 ? ['breakfast', 'lunch', 'snack'] : ['breakfast', 'lunch', 'snack', 'dinner'];
    for (const slot of slots) {
      if (slot === 'snack' && day % 3 === 1) continue;
      const dish = MENU[slot][(day * 7 + slot.length) % MENU[slot].length];
      meals.push({
        id: `demo-${day}-${slot}`,
        date,
        time: TIMES[slot],
        slot,
        title: say(dish[0]),
        items: [],
        nutrients: nutrients(dish),
        score: dish[6],
        source: slot === 'snack' ? 'search' : 'photo',
      });
    }
  }

  const cook: CookSteps = {
    minutes: RECIPE.minutes,
    steps: RECIPE.steps.map(([text]) => say(text)),
    tip: say(RECIPE.tip),
    detail: RECIPE.steps.map(([, action, minutes]) => (minutes ? { action, minutes } : { action })),
    labels: 5,
  };
  const items: FoodItem[] = INGREDIENTS.map(([name, emoji, portion, grams, calories, protein, carbs, fat, fibre], i) => ({
    id: `demo-ingredient-${i}`,
    name: say(name),
    emoji,
    portion: say(portion),
    grams,
    nutrients: { calories, protein, carbs, fat, fibre, sugar: Math.round(carbs * 0.1), sodium: Math.round(grams * 0.5) },
  }));
  const plans: MealEntry[] = PLANNED.map(([day, slot, dish], i) => ({
    id: `demo-plan-${i}`,
    date: addDays(today, day),
    time: '',
    slot,
    title: say(dish[0]),
    items: [] as FoodItem[],
    nutrients: nutrients(dish),
    score: dish[6],
    source: 'describe' as const,
    note: SQUISH_PLAN_NOTE,
    ...(i === 0 ? { cook, items } : {}),
  }));

  const days: DayLog[] = Array.from({ length: 14 }, (_, i) => ({
    date: addDays(today, i - 13),
    water: 5 + ((i * 3) % 4),
    steps: 6200 + ((i * 1733) % 5200),
    weightKg: +(79.4 - i * 0.12 + ((i % 3) - 1) * 0.15).toFixed(1),
  }));

  return {
    profile: {
      name: 'Sam',
      sex: 'other',
      age: 34,
      heightCm: 172,
      weightKg: 77.8,
      targetWeightKg: 72,
      activity: 'light',
      goal: 'lose',
      pace: 0.5,
      units: 'metric',
      onboarded: true,
      ...profile,
    } as Profile,
    meals,
    plans,
    days: Object.fromEntries(days.map((d) => [d.date, d])),
  };
}
