/**
 * Running the nutritionist's lookups, in the browser, against the real diary.
 *
 * The tools are declared on the server (`server/nutritionist-tools.ts`) and
 * answered here, because here is where the food is. Nothing in this file
 * talks to the network: it takes a snapshot of the store, reads it, and hands
 * back a few lines of text for the model to reason over.
 *
 * Those lines are written for a reader, not a parser. A model given
 * `{"d":"2026-05-12","kcal":2210}` spends effort decoding it; given
 * "Tue 12 May — 2210 kcal" it spends the effort on the question. The cost is
 * a few more tokens and it is worth it every time.
 *
 * Two rules hold throughout. Nothing is invented: a day nobody logged says so
 * rather than reading as a day of nought. And nothing is unbounded: every
 * range is clamped and every list is capped, because a two-year query would
 * put the whole diary through the model at the person's expense.
 */
import type { DayLog, MealEntry, MicroKey, Nutrients, Profile, Targets } from '../types';
import { MICROS } from '../types';
import { addDays, daysBetween, isoDate, parseISO } from './date';
import { mealsOn, dayScore, totalsOn } from './selectors';
import { CEILING_LABEL, MICRO_LABEL, MICRO_UNIT, ceilingLimit, dayVerdict, microTargets } from './nutrition';
import { saltGrams } from './units';

/** Something the nutritionist decided to keep. */
export interface NutritionistNote {
  id: string;
  note: string;
  /** ISO date it was written, so the You screen can say how old it is. */
  date: string;
}

/** Everything a lookup is allowed to see. */
export interface Diary {
  meals: MealEntry[];
  days: Record<string, DayLog>;
  profile: Profile;
  targets: Targets;
  notes: NutritionistNote[];
  /** Today, passed in rather than read, so a test can sit on a fixed date. */
  today: string;
}

/** And the two things it is allowed to change. */
export interface DiaryActions {
  remember: (note: string) => NutritionistNote;
  forget: (id: string) => boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolAnswer {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** Six weeks. Longer than any question a person actually asks day by day. */
const MAX_RANGE_DAYS = 42;
const MAX_MEALS = 40;
const DEFAULT_MEALS = 15;
const MAX_NOTE = 240;
const MAX_NOTES = 40;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** A date the model gave us, or nothing. Invalid text is not a silent today. */
function asDate(value: unknown): string | undefined {
  const text = str(value);
  if (!text || !ISO.test(text)) return undefined;
  return Number.isNaN(parseISO(text).getTime()) ? undefined : text;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue 12 May" — a date a person would say out loud. */
export function sayDate(iso: string): string {
  const d = parseISO(iso);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

/**
 * A range that is in order, in the past, and not enormous.
 *
 * Trimmed from the near end rather than refused: somebody asking about "this
 * year" wants an answer about the part of it we can send, and being told the
 * range was shortened is better than being told no.
 */
export function clampRange(from: string | undefined, to: string | undefined, today: string) {
  let end = to ?? today;
  let start = from ?? addDays(end, -6);
  if (start > end) [start, end] = [end, start];
  // Nothing is logged in the future, and a range ending there only wastes days.
  if (end > today) end = today;
  if (start > end) start = end;

  const span = daysBetween(start, end) + 1;
  const trimmed = span > MAX_RANGE_DAYS;
  if (trimmed) start = addDays(end, -(MAX_RANGE_DAYS - 1));

  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  return { start, end, dates, trimmed };
}

/**
 * What the diary actually covers, said whenever a lookup finds nothing.
 *
 * Belt and braces against asking about the wrong stretch of time. An empty
 * answer on its own is indistinguishable from a person who logged nothing,
 * and the model has no way to tell which it is looking at — so it says, and
 * a lookup aimed at the wrong month can be aimed again instead of reported
 * as a blank fortnight.
 */
function span(diary: Diary): string {
  const logged = diary.meals.map((m) => m.date).sort();
  if (!logged.length) return 'Their diary is empty — nothing has ever been logged.';
  return `Their diary runs from ${sayDate(logged[0])} (${logged[0]}) to ${sayDate(logged[logged.length - 1])} (${logged[logged.length - 1]}), and today is ${sayDate(diary.today)} (${diary.today}).`;
}

const g = (value: number | undefined): string => (value === undefined ? '?' : `${Math.round(value)} g`);

/** One day in one line, with everything the ceilings are judged on. */
function dayLine(date: string, diary: Diary): string {
  const totals = totalsOn(diary.meals, date);
  const count = mealsOn(diary.meals, date).length;
  if (!count) return `${sayDate(date)} (${date}) — nothing logged`;

  const score = dayScore(diary.meals, date, diary.targets);
  const verdict = dayVerdict(score, totals, diary.targets);
  const day = diary.days[date];

  const parts = [
    `${Math.round(totals.calories)} kcal`,
    `protein ${g(totals.protein)}`,
    `carbs ${g(totals.carbs)}`,
    `fat ${g(totals.fat)}`,
    `fibre ${g(totals.fibre)}`,
    `saturates ${g(totals.satFat)}`,
    `sugar ${g(totals.sugar)}`,
    `free sugars ${g(totals.freeSugar)}`,
    `salt ${saltGrams(totals.sodium ?? 0)} g`,
    `score ${score}/100 (${verdict.label})`,
    `${count} meal${count === 1 ? '' : 's'}`,
  ];
  if (day?.water) parts.push(`water ${day.water} glasses`);
  if (day?.steps) parts.push(`${day.steps} steps`);
  if (day?.weightKg) parts.push(`weighed ${day.weightKg} kg`);

  return `${sayDate(date)} (${date}) — ${parts.join(', ')}`;
}

/** The ceilings, so the model is judging days against the same lines the app is. */
function targetLine(t: Targets): string {
  const limits = (['fat', 'satFat', 'sugar', 'freeSugar', 'sodium'] as const)
    .map((key) => {
      const limit = ceilingLimit(key, t);
      if (!limit) return '';
      const label = CEILING_LABEL[key].toLowerCase();
      return key === 'sodium' ? `${label} under ${saltGrams(limit)} g salt` : `${label} under ${limit} g`;
    })
    .filter(Boolean);

  return `Their targets: ${Math.round(t.calories)} kcal, protein ${t.protein} g, fibre ${t.fibre} g. Daily limits: ${limits.join(', ')}.`;
}

function lookUpDays(input: Record<string, unknown>, diary: Diary): string {
  const { start, end, dates, trimmed } = clampRange(asDate(input.from), asDate(input.to), diary.today);
  const lines = dates.map((date) => dayLine(date, diary));
  const logged = dates.filter((date) => totalsOn(diary.meals, date).calories > 0).length;

  if (!logged) return `Nothing logged between ${sayDate(start)} and ${sayDate(end)}. ${span(diary)}`;

  return [
    `${sayDate(start)} to ${sayDate(end)}: ${logged} of ${dates.length} days logged.`,
    trimmed ? `(Range was longer than ${MAX_RANGE_DAYS} days and was trimmed to the most recent ${MAX_RANGE_DAYS}.)` : '',
    targetLine(diary.targets),
    '',
    ...lines,
  ]
    .filter(Boolean)
    .join('\n');
}

function mealLine(meal: MealEntry): string {
  const n = meal.nutrients;
  const items = meal.items.map((i) => `${i.name} ${i.portion}${i.grams ? ` (${Math.round(i.grams)} g)` : ''}`);
  const head = `${sayDate(meal.date)} ${meal.time} ${meal.slot} — ${meal.title}`;
  const nutrition =
    `${Math.round(n.calories)} kcal, protein ${g(n.protein)}, carbs ${g(n.carbs)}, fat ${g(n.fat)}, ` +
    `fibre ${g(n.fibre)}, saturates ${g(n.satFat)}, sugar ${g(n.sugar)}, free sugars ${g(n.freeSugar)}, ` +
    `salt ${saltGrams(n.sodium ?? 0)} g, score ${meal.score}/100`;
  return `${head}\n  ${items.join('; ') || 'no items listed'}\n  ${nutrition}${meal.note ? `\n  Their note: ${meal.note}` : ''}`;
}

function findMeals(input: Record<string, unknown>, diary: Diary): string {
  const to = asDate(input.to) ?? diary.today;
  const from = asDate(input.from) ?? addDays(to, -30);
  const query = str(input.query)?.toLowerCase();
  const asked = Number(input.limit);
  const limit = Math.min(MAX_MEALS, Math.max(1, Number.isFinite(asked) && asked > 0 ? Math.round(asked) : DEFAULT_MEALS));

  const words = query ? query.split(/\s+/).filter((w) => w.length > 2) : [];
  const matches = diary.meals
    .filter((meal) => meal.date >= from && meal.date <= to)
    .filter((meal) => {
      if (!words.length) return true;
      const haystack = `${meal.title} ${meal.items.map((i) => i.name).join(' ')} ${meal.note ?? ''}`.toLowerCase();
      // Any word, not all: "chicken curry" should still find the katsu curry.
      return words.some((word) => haystack.includes(word));
    })
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));

  const shown = matches.slice(0, limit);
  if (!shown.length) {
    const where = query ? `No meals matching "${query}"` : 'No meals logged';
    return `${where} between ${sayDate(from)} and ${sayDate(to)}. ${span(diary)}`;
  }

  const head =
    `${matches.length} meal${matches.length === 1 ? '' : 's'}` +
    `${query ? ` matching "${query}"` : ''} between ${sayDate(from)} and ${sayDate(to)}` +
    `${matches.length > shown.length ? `, showing the ${shown.length} most recent` : ''}:`;

  return [head, '', ...shown.map(mealLine)].join('\n');
}

/**
 * Averages against targets, including the vitamins and minerals.
 *
 * Coverage is stated with every micronutrient figure and it is not a detail.
 * Most logged meals carry no micronutrient data at all, so an average over the
 * ones that do is an average over a fraction of the food. "12 mg of iron
 * across the 3 of 21 meals that reported it" is honest; "12 mg of iron" is
 * not.
 */
function nutrientReport(input: Record<string, unknown>, diary: Diary): string {
  const { start, end, dates, trimmed } = clampRange(asDate(input.from), asDate(input.to), diary.today);
  const logged = dates.filter((date) => totalsOn(diary.meals, date).calories > 0);

  if (!logged.length) return `Nothing logged between ${sayDate(start)} and ${sayDate(end)}. ${span(diary)}`;

  const totals = logged.map((date) => totalsOn(diary.meals, date));
  const mean = (pick: (n: Nutrients) => number | undefined) => {
    const values = totals.map(pick).filter((v): v is number => v !== undefined);
    return values.length ? { value: values.reduce((s, v) => s + v, 0) / values.length, days: values.length } : null;
  };

  const t = diary.targets;
  const row = (label: string, got: ReturnType<typeof mean>, target: number, unit = 'g', aim: 'at least' | 'under' = 'under') => {
    if (!got || !target) return `- ${label}: not enough data`;
    const share = Math.round((got.value / target) * 100);
    const coverage = got.days === logged.length ? '' : ` (from the ${got.days} of ${logged.length} days that reported it)`;
    return `- ${label}: ${Math.round(got.value * 10) / 10} ${unit} a day against ${aim} ${target} ${unit} — ${share}%${coverage}`;
  };

  const meals = diary.meals.filter((m) => m.date >= start && m.date <= end);
  const withMicros = meals.filter((m) => m.nutrients.micros && Object.keys(m.nutrients.micros).length).length;
  const wanted = microTargets(diary.profile);

  const microRows = MICROS.map((key: MicroKey) => {
    const got = mean((n) => n.micros?.[key]);
    const target = wanted[key] ?? 0;
    if (!got) return `- ${MICRO_LABEL[key]}: nothing logged reported it`;
    const share = Math.round((got.value / target) * 100);
    return (
      `- ${MICRO_LABEL[key]}: about ${Math.round(got.value * 10) / 10} ${MICRO_UNIT[key]} a day against ${target} ${MICRO_UNIT[key]} — ${share}%` +
      ` (from the ${got.days} of ${logged.length} days with any figure)`
    );
  });

  return [
    `${sayDate(start)} to ${sayDate(end)}: ${logged.length} of ${dates.length} days logged.`,
    trimmed ? `(Range trimmed to the most recent ${MAX_RANGE_DAYS} days.)` : '',
    '',
    'Daily averages across the logged days:',
    row('Energy', mean((n) => n.calories), t.calories, 'kcal', 'at least'),
    row('Protein', mean((n) => n.protein), t.protein, 'g', 'at least'),
    row('Fibre', mean((n) => n.fibre), t.fibre, 'g', 'at least'),
    row('Fat', mean((n) => n.fat), ceilingLimit('fat', t)),
    row('Saturates', mean((n) => n.satFat), ceilingLimit('satFat', t)),
    row('Sugar', mean((n) => n.sugar), ceilingLimit('sugar', t)),
    row('Free sugars', mean((n) => n.freeSugar), ceilingLimit('freeSugar', t)),
    row('Salt', mean((n) => saltGrams(n.sodium ?? 0)), saltGrams(ceilingLimit('sodium', t))),
    '',
    `Vitamins and minerals. ${withMicros} of the ${meals.length} meals in this range carried any figures at all, so treat these as a floor rather than a total:`,
    ...microRows,
  ]
    .filter(Boolean)
    .join('\n');
}

function remember(input: Record<string, unknown>, diary: Diary, actions: DiaryActions): string {
  const note = str(input.note);
  if (!note) return 'Nothing to remember — the note was empty.';
  if (diary.notes.length >= MAX_NOTES) {
    return `You are already remembering ${MAX_NOTES} things, which is the limit. Forget one first if this matters more.`;
  }
  // Same fact twice is the commonest failure here, and it makes the memory
  // read like a stutter within a few conversations.
  const trimmed = note.slice(0, MAX_NOTE);
  if (diary.notes.some((n) => n.note.toLowerCase() === trimmed.toLowerCase())) {
    return 'You already remember that, word for word. Nothing saved.';
  }
  const saved = actions.remember(trimmed);
  return `Saved as [${saved.id}]: ${saved.note}`;
}

function forget(input: Record<string, unknown>, actions: DiaryActions): string {
  const id = str(input.id);
  if (!id) return 'No id given, so nothing was forgotten.';
  return actions.forget(id) ? `Forgotten [${id}].` : `Nothing here with the id [${id}].`;
}

/** Answer one call. Never throws: a broken lookup is a result, not a crash. */
export function runTool(call: ToolCall, diary: Diary, actions: DiaryActions): ToolAnswer {
  const answer = (content: string, isError = false): ToolAnswer => ({
    type: 'tool_result',
    tool_use_id: call.id,
    content,
    ...(isError ? { is_error: true } : {}),
  });

  try {
    switch (call.name) {
      case 'look_up_days':
        return answer(lookUpDays(call.input, diary));
      case 'find_meals':
        return answer(findMeals(call.input, diary));
      case 'nutrient_report':
        return answer(nutrientReport(call.input, diary));
      case 'remember':
        return answer(remember(call.input, diary, actions));
      case 'forget':
        return answer(forget(call.input, actions));
      default:
        return answer(`There is no tool called ${call.name}.`, true);
    }
  } catch {
    // The model can recover from "that lookup failed" and cannot recover from
    // a blank screen, so the failure goes back as a result.
    return answer('That lookup failed. Try a different range, or answer from what you already have.', true);
  }
}

/** What to show while a lookup runs. Plain English, because the user sees it. */
export function toolLabel(call: ToolCall): string {
  const from = asDate(call.input.from);
  const to = asDate(call.input.to);
  const range = from && to ? ` ${sayDate(from)} to ${sayDate(to)}` : '';

  switch (call.name) {
    case 'look_up_days':
      return `Reading your diary${range}`;
    case 'find_meals': {
      const query = str(call.input.query);
      return query ? `Looking for ${query}` : 'Looking through your meals';
    }
    case 'nutrient_report':
      return `Checking your nutrients${range}`;
    case 'remember':
      return 'Making a note';
    case 'forget':
      return 'Forgetting that';
    default:
      return 'Looking something up';
  }
}

/** A fresh note, with the id the model will use to forget it. */
export function newNote(note: string, today = isoDate()): NutritionistNote {
  return { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, note, date: today };
}
