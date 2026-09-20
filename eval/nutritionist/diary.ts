/**
 * One person's diary, invented on purpose.
 *
 * Every question in this eval is a question about *this* diary, so the diary
 * has to have answers. Real logs would be better in every way except the one
 * that matters here: nobody's real six weeks happens to contain a weekend
 * effect, a fish gap, a protein trend and a stretch of entries from before
 * Squish recorded saturates — and without those planted deliberately, half
 * the cases would have no right answer to mark against.
 *
 * So the properties below are built in, and `facts.ts` reads them back out by
 * computation rather than by hand. Change a number here and the expected
 * answers move with it; nothing is written down twice.
 *
 * What is planted, and which cases lean on it:
 *   - Weekends run well over target, weekdays a little under.
 *   - Protein climbs from about 75 g a day in week one to about 115 g in week six.
 *   - Oily fish twice in six weeks, and nowhere near the end of it.
 *   - Micronutrients on breakfasts only — a third of the meals — so any
 *     average over them covers a minority of the food and has to say so.
 *   - B12 and folate never reported by anything.
 *   - Entries before 23 April carry no saturates or free sugars at all, the
 *     way anybody's diary does across a version of the app that did not ask.
 *   - One deliberate blow-out: Saturday 9 May, well over the saturates ceiling.
 */
import type { MealEntry, MealSlot, Nutrients } from '../../src/types';
import { addDays, parseISO } from '../../src/lib/date';
import { qualityScore, ultraProcessedShare } from '../../src/lib/nutrition';

/** Fixed, because "last week" has to mean the same week every time it runs. */
export const TODAY = '2026-05-20';
export const FIRST_DAY = addDays(TODAY, -41);
/** Before this, nothing reported saturated fat or free sugars. */
const DETAIL_FROM = '2026-04-23';

const isWeekend = (iso: string) => [0, 6].includes(parseISO(iso).getDay());

interface Template {
  title: string;
  slot: MealSlot;
  time: string;
  n: Nutrients;
  /** Only breakfasts carry these, which is what makes coverage a real problem. */
  micros?: Nutrients['micros'];
}

const BREAKFASTS: Template[] = [
  { title: 'Porridge with berries', slot: 'breakfast', time: '07:40',
    n: { calories: 410, protein: 16, carbs: 62, fat: 9, fibre: 8, sugar: 14, freeSugar: 3, satFat: 2, sodium: 180 },
    micros: { iron: 3.8, calcium: 260, vitaminC: 14 } },
  { title: 'Greek yoghurt and granola', slot: 'breakfast', time: '08:05',
    n: { calories: 380, protein: 20, carbs: 44, fat: 12, fibre: 5, sugar: 20, freeSugar: 9, satFat: 5, sodium: 120 },
    micros: { iron: 2.1, calcium: 320, vitaminC: 6 } },
  { title: 'Two poached eggs on toast', slot: 'breakfast', time: '08:20',
    n: { calories: 440, protein: 24, carbs: 38, fat: 20, fibre: 4, sugar: 4, freeSugar: 1, satFat: 6, sodium: 620 },
    micros: { iron: 3.2, calcium: 110, vitaminD: 3.4, vitaminC: 2 } },
];

const LUNCHES: Template[] = [
  { title: 'Chicken salad wrap', slot: 'lunch', time: '12:45',
    n: { calories: 520, protein: 34, carbs: 48, fat: 20, fibre: 6, sugar: 6, freeSugar: 2, satFat: 5, sodium: 940 } },
  { title: 'Jacket potato with beans', slot: 'lunch', time: '13:10',
    n: { calories: 560, protein: 20, carbs: 96, fat: 8, fibre: 14, sugar: 18, freeSugar: 6, satFat: 3, sodium: 880 } },
  { title: 'Leftover chilli and rice', slot: 'lunch', time: '12:30',
    n: { calories: 640, protein: 36, carbs: 78, fat: 18, fibre: 9, sugar: 8, freeSugar: 1, satFat: 7, sodium: 1020 } },
];

const DINNERS: Template[] = [
  { title: 'Spaghetti bolognese', slot: 'dinner', time: '19:20',
    n: { calories: 780, protein: 42, carbs: 88, fat: 26, fibre: 8, sugar: 12, freeSugar: 2, satFat: 10, sodium: 1180 } },
  { title: 'Chicken and roast vegetables', slot: 'dinner', time: '19:00',
    n: { calories: 700, protein: 48, carbs: 54, fat: 28, fibre: 9, sugar: 10, freeSugar: 0, satFat: 8, sodium: 860 } },
  { title: 'Katsu curry', slot: 'dinner', time: '19:45',
    n: { calories: 980, protein: 38, carbs: 118, fat: 38, fibre: 6, sugar: 22, freeSugar: 14, satFat: 12, sodium: 1640 } },
];

/** The two oily-fish meals in the whole six weeks, and the only vitamin D worth the name. */
const SALMON: Template = {
  title: 'Salmon fillet with new potatoes', slot: 'dinner', time: '19:15',
  n: { calories: 640, protein: 46, carbs: 42, fat: 30, fibre: 6, sugar: 5, freeSugar: 0, satFat: 6, sodium: 520 },
  micros: { iron: 1.4, calcium: 60, vitaminD: 13.2, vitaminC: 22 },
};
export const FISH_DAYS = ['2026-04-27', '2026-05-11'];

/** What a weekend adds on top: the pub, and the takeaway after it. */
const WEEKEND_EXTRAS: Template[] = [
  { title: 'Crisps and two pints', slot: 'snack', time: '21:30',
    n: { calories: 720, protein: 8, carbs: 62, fat: 22, fibre: 2, sugar: 3, freeSugar: 0, satFat: 11, sodium: 1220 } },
  { title: 'Cheese and biscuits', slot: 'snack', time: '22:10',
    n: { calories: 430, protein: 14, carbs: 26, fat: 30, fibre: 1, sugar: 4, freeSugar: 1, satFat: 18, sodium: 760 } },
];

/** The blow-out. One day, deliberately far over the saturates ceiling. */
const BLOWOUT_DAY = '2026-05-09';

/**
 * Protein climbing week by week, because "is my protein getting better?" needs
 * an answer that is not "about the same". Applied to the main meals only.
 */
function proteinLift(date: string): number {
  const week = Math.floor((parseISO(date).getTime() - parseISO(FIRST_DAY).getTime()) / (7 * 86_400_000));
  return 1 + Math.max(0, Math.min(5, week)) * 0.09;
}

function itemsFor(t: Template, n: Nutrients): MealEntry['items'] {
  return [{ id: `${t.title}-i`, name: t.title, portion: '1 serving', grams: 320, nutrients: n }];
}

function mealFrom(date: string, t: Template, index: number): MealEntry {
  const lift = t.slot === 'snack' ? 1 : proteinLift(date);
  const detailed = date >= DETAIL_FROM;
  const n: Nutrients = {
    ...t.n,
    protein: Math.round(t.n.protein * lift),
    // Before the app asked, nothing knew. Undefined, not nought — the
    // difference is the whole of the honesty split.
    satFat: detailed ? t.n.satFat : undefined,
    freeSugar: detailed ? t.n.freeSugar : undefined,
    micros: t.micros,
  };
  return {
    id: `${date}-${index}`, date, time: t.time, slot: t.slot, title: t.title,
    items: itemsFor(t, n), nutrients: n,
    // The app's own scorer, not a made-up number — every question about how a
    // day went is answered against these.
    score: qualityScore(n, ultraProcessedShare(itemsFor(t, n))),
    source: 'photo',
  };
}

/** A deterministic pick, so the six weeks are the same six weeks every run. */
const pick = <T,>(list: T[], date: string, salt: number) =>
  list[(parseISO(date).getDate() + salt) % list.length];

export function buildDiary(): MealEntry[] {
  const meals: MealEntry[] = [];

  for (let date = FIRST_DAY; date <= TODAY; date = addDays(date, 1)) {
    // Two days off in the middle, because nobody logs forty-two days straight
    // and "how many days did I log" should have a real answer.
    if (date === '2026-04-18' || date === '2026-05-03') continue;

    const templates: Template[] = [pick(BREAKFASTS, date, 0), pick(LUNCHES, date, 1)];
    templates.push(FISH_DAYS.includes(date) ? SALMON : pick(DINNERS, date, 2));
    if (isWeekend(date)) templates.push(pick(WEEKEND_EXTRAS, date, 0));
    if (date === BLOWOUT_DAY) templates.push(WEEKEND_EXTRAS[1], DINNERS[2]);

    templates.forEach((t, i) => meals.push(mealFrom(date, t, i)));
  }

  return meals;
}
