import { useSyncExternalStore } from 'react';
import { planNow, watchStanding, type Standing } from '../lib/plan';
import { plural, t } from '../lib/i18n';

const subscribe = (listener: () => void) => watchStanding(() => listener());

/** What the server last said about this person. Never read from storage. */
export const useStanding = (): Standing => useSyncExternalStore(subscribe, planNow);

/** Whether the server last said this person is on Plus. */
export const useSubscribed = (): boolean => useStanding().plan === 'plus';

export interface NutritionistAccess {
  /** No questions to ask with: signed out, or a free taste used up. */
  locked: boolean;
  /** Signed out: an account would unlock a free taste. */
  needsAccount: boolean;
  /** A few words for a badge: "3 free questions", "24 left this month", "Plus". */
  label: string | null;
  standing: Standing;
}

/**
 * Where somebody stands with the nutritionist, for the places that offer it.
 * Nothing is locked until the server has answered, and nothing at all where
 * this Squish has no tiers.
 */
export function useNutritionistAccess(): NutritionistAccess {
  const standing = useStanding();
  if (!standing.known || standing.off) return { locked: false, needsAccount: false, label: null, standing };
  const left = standing.left.chat;
  if (standing.plan === 'plus') return { locked: false, needsAccount: false, label: t('{n} left this month', { n: left }), standing };
  if (standing.needsAccount) return { locked: true, needsAccount: true, label: t('Free to try'), standing };
  if (left > 0) return { locked: false, needsAccount: false, label: plural(left, { one: '{n} free question', other: '{n} free questions' }), standing };
  return { locked: true, needsAccount: false, label: 'Squish Plus', standing };
}
