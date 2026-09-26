/**
 * Questions worth asking the nutritionist, from the diary as it stands.
 *
 * "Ask me anything" is the least inviting sentence in software: nobody knows
 * what to ask an app. A question about *their* afternoon — the protein still
 * to find, the lunch they just logged, the week just gone — both answers that
 * and shows what the nutritionist is for before it is ever used. Worked out
 * here, from the diary, with no AI: these are only the questions, and asking
 * one is what spends anything.
 */
import type { MealEntry, Targets } from '../types';
import { addDays, lastDays } from './date';
import { EMPTY, addNutrients } from './nutrition';
import { formatEnergy, localWords } from './region';
import { t } from './i18n';

const FALLBACKS = () => [t('What am I short of?'), t('Is my protein getting better?'), t('When did I last eat fish?'), t('What’s a good high-protein breakfast?')];

export function suggestedQuestions(meals: MealEntry[], targets: Targets, today: string, hour: number, count = 3): string[] {
  const out: string[] = [];
  const add = (q: string | null | false) => {
    if (q && !out.includes(q)) out.push(q);
  };

  const todays = meals.filter((m) => m.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const eaten = todays.reduce((acc, m) => addNutrients(acc, m.nutrients), { ...EMPTY });
  const proteinGap = Math.round(targets.protein - eaten.protein);
  const kcalLeft = Math.round(targets.calories - eaten.calories);

  // Today first: it is what they are thinking about.
  if (hour >= 16 && hour < 21 && kcalLeft >= 300) add(t('What should I have for dinner with {energy} left?', { energy: formatEnergy(kcalLeft) }));
  if (todays.length && hour >= 12 && proteinGap >= 25) add(t('How can I get {grams} g more protein today?', { grams: proteinGap }));
  const latest = todays.at(-1);
  if (latest && latest.title.trim().length <= 40) add(t('Was my {meal} a good choice?', { meal: latest.title.trim().toLocaleLowerCase() }));

  // Then the week.
  const week = lastDays(7, addDays(today, -1));
  const logged = week.filter((d) => meals.some((m) => m.date === d));
  if (logged.length >= 3) {
    add(t('How was my week?'));
    const fibre = meals.filter((m) => logged.includes(m.date)).reduce((sum, m) => sum + m.nutrients.fibre, 0) / logged.length;
    if (fibre < targets.fibre * 0.7) add(localWords(t('How can I eat more fibre?')));
  }

  for (const q of FALLBACKS()) add(q);
  return out.slice(0, count);
}
