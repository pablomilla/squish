/**
 * The words under "Your plan": what the two energy numbers are, and how one
 * follows from the other.
 *
 * The card showed a daily target and a maintenance figure side by side and
 * left the reader to work out that one is what the body burns and the other
 * is that, minus (or plus) what the pace asks for. Here it is said once, in
 * the reader's own numbers, and the sums behind every figure are there for
 * anybody who wants them.
 */
import { ACTIVITY_LABEL, computeTargets, tdee } from './nutrition';
import { formatPace, formatWeightDelta } from './units';
import { aboutEnergy, fibreWord, formatEnergy } from './region';
import type { Profile, Targets } from '../types';

/** A kilogram of body fat, near enough, in kcal. The same figure the targets use. */
const KCAL_PER_KG = 7700;

/** In kcal or kJ, whichever they count in. */
const kcal = (n: number) => formatEnergy(n);

export interface PlanExplained {
  /** What eating the target should do, in a sentence or two. */
  summary: string;
  /** How each number is worked out. */
  how: { label: string; words: string }[];
}

export function explainPlan(profile: Profile, targets: Targets): PlanExplained {
  const burns = Math.round(tdee(profile));
  const gap = burns - targets.calories;
  const weekly = Math.abs((gap * 7) / KCAL_PER_KG);
  const amount = formatWeightDelta(weekly, profile.units).replace('+', '');
  // The target is rounded to tens, so the gap is too: "550 less", not "549".
  const diff = (n: number) => kcal(Math.round(n / 10) * 10);

  const opening = `Your body burns about ${kcal(burns)} a day. That's your maintenance: eat that much and your weight stays where it is.`;
  let summary: string;
  if (Math.abs(gap) < 50 || weekly < 0.05) {
    summary = `${opening} Your target is the same, so your weight should hold steady.`;
  } else if (gap > 0) {
    summary = `${opening} Your target is ${diff(gap)} less, which should mean losing about ${amount} a week.`;
  } else {
    summary = `${opening} Your target is ${diff(-gap)} more, which should mean gaining about ${amount} a week.`;
  }

  const suggested = computeTargets(profile);
  const customised = suggested.calories !== targets.calories;
  // The floor held the target up, so it is slower than the pace they chose.
  const floor = profile.sex === 'male' ? 1500 : 1200;
  if (!customised && profile.goal === 'lose' && suggested.calories === floor && gap * 7 < profile.pace * KCAL_PER_KG - 1) {
    summary += ` Squish won't suggest less than ${kcal(floor)} a day, so that's slower than the ${formatPace(profile.pace, profile.units)} a week you picked.`;
  }
  if (customised) summary += ' You set this target yourself.';

  const tuned = profile.burnFactor && Math.abs(profile.burnFactor - 1) >= 0.005 ? Math.round((profile.burnFactor - 1) * 100) : 0;
  const perKg = profile.goal === 'lose' ? 1.8 : profile.goal === 'gain' ? 1.9 : 1.6;

  const how = [
    {
      label: 'Maintenance',
      words:
        `Worked out from your age, height, weight and sex (the Mifflin–St Jeor formula), then raised for being ${ACTIVITY_LABEL[profile.activity].toLowerCase()}.` +
        (tuned ? ` Then adjusted ${tuned > 0 ? '+' : ''}${tuned}% to match what your own logs and weigh-ins show.` : ''),
    },
    {
      label: 'Daily target',
      words:
        profile.goal === 'maintain'
          ? 'The same as maintenance, because your goal is to stay steady.'
          : `Maintenance ${profile.goal === 'lose' ? 'minus' : 'plus'} what your pace needs. A kilogram of body fat is roughly ${aboutEnergy(KCAL_PER_KG)}, so ${formatPace(profile.pace, profile.units)} a week is about ${kcal(Math.round((Math.min(profile.pace, 1) * KCAL_PER_KG) / 7))} a day.`,
    },
    {
      label: 'Protein',
      words: `${perKg} g for each kg you weigh${profile.goal === 'lose' ? ' — higher while losing, to help keep muscle' : profile.goal === 'gain' ? ', to help build muscle' : ''}.`,
    },
    { label: fibreWord(), words: `14 g for every ${aboutEnergy(1000)} you eat: the usual guide for a healthy gut and heart.` },
  ];

  return { summary, how };
}
