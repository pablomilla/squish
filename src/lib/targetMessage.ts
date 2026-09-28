/**
 * What onboarding says about a goal weight, once it is set: how much, how
 * long, and an honest word about it. Worked out from what they chose —
 * the size of the change against their weight, the pace, how long it would
 * take, and whether the goal is a healthy weight at all — so a small goal, a
 * big one and a rushed one each hear something different.
 *
 * Kept out of the screen so the wording rules can be tested without one.
 */
import type { Goal, Mood, Profile } from '../types';
import { t } from './i18n';
import { formatPace, formatWeight } from './units';
import { aroundWhen } from './goalDate';

/** How quick a pace is. Gaining is slower at every level: muscle builds slower than fat goes. */
export type PaceTier = 'steady' | 'brisk' | 'fast';
export function paceTier(kgPerWeek: number, goal: Goal): PaceTier {
  const [steady, brisk] = goal === 'gain' ? [0.25, 0.5] : [0.35, 0.7];
  return kgPerWeek <= steady + 1e-9 ? 'steady' : kgPerWeek <= brisk + 1e-9 ? 'brisk' : 'fast';
}

export interface TargetMessage {
  kind: 'low' | 'fast' | 'big' | 'small' | 'realistic';
  mood: Mood;
  headline: string;
  detail: string;
  footer: string;
}

/** Below this share of their weight, a goal is small; above the next, big. */
const SMALL = 0.05;
const BIG = 0.15;
/** Longer than this, it is said in years, with the first milestone to aim at instead. */
const LONG_WEEKS = 104;

export function targetMessage(profile: Profile, weeks: number, date: Date): TargetMessage {
  const change = Math.abs(profile.weightKg - profile.targetWeightKg);
  const share = change / profile.weightKg;
  const amount = formatWeight(change, profile.units);
  const pace = formatPace(profile.pace, profile.units);
  const when = aroundWhen(date);
  const n = Math.max(1, Math.round(weeks));
  const gain = profile.goal === 'gain';
  const bmi = profile.targetWeightKg / (profile.heightCm / 100) ** 2;

  // The first 5%: a milestone for a big goal, and where the health benefit of losing weight starts.
  const firstStep = profile.weightKg * SMALL;
  const milestone = formatWeight(gain ? profile.weightKg + firstStep : profile.weightKg - firstStep, profile.units);
  const milestoneWeeks = Math.max(1, Math.round(firstStep / profile.pace));

  const steadyWords = t('At {pace} a week, that is about {weeks} weeks — around {when}.', { pace, weeks: n, when });
  const footer = gain
    ? t('Plenty of protein and some strength work make it muscle rather than fat.')
    : share >= SMALL
      ? t('Even the first 5% — {amount} — is known to help blood pressure and blood sugar.', { amount: formatWeight(firstStep, profile.units) })
      : t('Steady is what lasts: small changes you can keep up, week after week.');

  if (!gain && bmi < 18.5) {
    return {
      kind: 'low',
      mood: 'thinking',
      headline: t('Let’s aim a little higher'),
      detail: t('{weight} is below a healthy weight for your height. Squish will plan towards it gently, but a goal a little higher is kinder to your body.', {
        weight: formatWeight(profile.targetWeightKg, profile.units),
      }),
      footer: t('Steady is what lasts: small changes you can keep up, week after week.'),
    };
  }

  if (paceTier(profile.pace, profile.goal) === 'fast') {
    return {
      kind: 'fast',
      mood: 'thinking',
      headline: gain ? t('Gaining {amount} by {when} is quick', { amount, when }) : t('Losing {amount} by {when} is ambitious', { amount, when }),
      detail: gain
        ? t('At {pace} a week, that is about {weeks} weeks. Much faster than this mostly adds fat — a slower build keeps it muscle.', { pace, weeks: n })
        : t('At {pace} a week, that is about {weeks} weeks. Quick losses are harder to keep up and cost more muscle — a notch slower tends to last.', { pace, weeks: n }),
      footer,
    };
  }

  if (share > BIG) {
    return {
      kind: 'big',
      mood: 'proud',
      headline: gain ? t('Gaining {amount} is a big goal — and a reachable one', { amount }) : t('{amount} is a big goal — and a reachable one', { amount }),
      detail:
        n > LONG_WEEKS
          ? t('At {pace} a week, that is about {years} years — a long road, so take it in stages. Your first milestone, {milestone}, is about {mweeks} weeks away.', {
              pace,
              years: Math.round((n / 52) * 10) / 10,
              milestone,
              mweeks: milestoneWeeks,
            })
          : t('About {weeks} weeks at {pace} a week — around {when}. Take it in stages: your first milestone is {milestone}, about {mweeks} weeks away.', {
              weeks: n,
              pace,
              when,
              milestone,
              mweeks: milestoneWeeks,
            }),
      footer,
    };
  }

  if (share < SMALL) {
    return {
      kind: 'small',
      mood: 'cheering',
      headline: gain ? t('Gaining {amount} is very doable', { amount }) : t('Losing {amount} is very doable', { amount }),
      detail: steadyWords,
      footer,
    };
  }

  return {
    kind: 'realistic',
    mood: 'proud',
    headline: gain ? t('Gaining {amount} is a realistic goal', { amount }) : t('Losing {amount} is a realistic goal', { amount }),
    detail: steadyWords,
    footer,
  };
}
