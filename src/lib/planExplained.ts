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
import { t } from './i18n';
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

  const opening = t("Your body burns about {energy} a day. That's your maintenance: eat that much and your weight stays where it is.", { energy: kcal(burns) });
  let summary: string;
  if (Math.abs(gap) < 50 || weekly < 0.05) {
    summary = `${opening} ${t('Your target is the same, so your weight should hold steady.')}`;
  } else if (gap > 0) {
    summary = `${opening} ${t('Your target is {energy} less, which should mean losing about {weight} a week.', { energy: diff(gap), weight: amount })}`;
  } else {
    summary = `${opening} ${t('Your target is {energy} more, which should mean gaining about {weight} a week.', { energy: diff(-gap), weight: amount })}`;
  }

  const suggested = computeTargets(profile);
  const customised = suggested.calories !== targets.calories;
  // The floor held the target up, so it is slower than the pace they chose.
  const floor = profile.sex === 'male' ? 1500 : 1200;
  if (!customised && profile.goal === 'lose' && suggested.calories === floor && gap * 7 < profile.pace * KCAL_PER_KG - 1) {
    summary += ` ${t("Squish won't suggest less than {energy} a day, so that's slower than the {pace} a week you picked.", { energy: kcal(floor), pace: formatPace(profile.pace, profile.units) })}`;
  }
  if (customised) summary += ` ${t('You set this target yourself.')}`;

  const tuned = profile.burnFactor && Math.abs(profile.burnFactor - 1) >= 0.005 ? Math.round((profile.burnFactor - 1) * 100) : 0;
  const perKg = profile.goal === 'lose' ? 1.8 : profile.goal === 'gain' ? 1.9 : 1.6;

  const how = [
    {
      label: t('Maintenance'),
      words:
        t('Worked out from your age, height, weight and sex (the Mifflin–St Jeor formula), then raised for being {activity}.', {
          activity: ACTIVITY_LABEL[profile.activity].toLocaleLowerCase(),
        }) + (tuned ? ` ${t('Then adjusted {percent}% to match what your own logs and weigh-ins show.', { percent: `${tuned > 0 ? '+' : ''}${tuned}` })}` : ''),
    },
    {
      label: t('Daily target'),
      words:
        profile.goal === 'maintain'
          ? t('The same as maintenance, because your goal is to stay steady.')
          : t(
              profile.goal === 'lose'
                ? 'Maintenance minus what your pace needs. A kilogram of body fat is roughly {fat}, so {pace} a week is about {energy} a day.'
                : 'Maintenance plus what your pace needs. A kilogram of body fat is roughly {fat}, so {pace} a week is about {energy} a day.',
              {
                fat: aboutEnergy(KCAL_PER_KG),
                pace: formatPace(profile.pace, profile.units),
                energy: kcal(Math.round((Math.min(profile.pace, 1) * KCAL_PER_KG) / 7)),
              },
            ),
    },
    {
      label: t('Protein'),
      words:
        profile.goal === 'lose'
          ? t('{grams} g for each kg you weigh — higher while losing, to help keep muscle.', { grams: perKg })
          : profile.goal === 'gain'
            ? t('{grams} g for each kg you weigh, to help build muscle.', { grams: perKg })
            : t('{grams} g for each kg you weigh.', { grams: perKg }),
    },
    { label: fibreWord(), words: t('14 g for every {energy} you eat: the usual guide for a healthy gut and heart.', { energy: aboutEnergy(1000) }) },
  ];

  return { summary, how };
}
