import { useEffect, useRef } from 'react';
import { useToast } from './ui';
import { achievementById, earnedFrom } from '../lib/achievements';
import { rewardsFor } from '../lib/rewards';
import { useSquish } from '../store/useSquish';
import { plural, t } from '../lib/i18n';
import { listWords } from '../lib/packs';

/**
 * Awards the badges the diary shows, and says so when one arrives.
 *
 * One place, running whatever screen is open, rather than a check on each
 * screen that happens to show the numbers: a badge earned from the diary is
 * noticed on Insights just as well as on Home, and one that arrived with a
 * restored backup is noticed at all.
 *
 * Every new badge is announced, however it was unlocked — here, or where a
 * feature was used — but never the ones somebody already had when the app
 * opened. The first time this runs for somebody with months of diary, the
 * badges the diary already earned arrive together, so they are announced
 * together rather than as a queue of toasts.
 */
export default function AchievementSync() {
  const meals = useSquish((s) => s.meals);
  const days = useSquish((s) => s.days);
  const targets = useSquish((s) => s.targets);
  const unlocked = useSquish((s) => s.unlocked);
  const toast = useToast();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const { unlock, unlocked: have } = useSquish.getState();
    for (const id of earnedFrom({ meals, days, targets })) if (!have[id]) unlock(id);
  }, [meals, days, targets]);

  useEffect(() => {
    const now = Object.keys(unlocked).filter((id) => achievementById(id));
    if (seen.current === null) {
      seen.current = new Set(now);
      return;
    }
    const fresh = now.filter((id) => !seen.current!.has(id));
    for (const id of fresh) seen.current.add(id);
    if (fresh.length === 1) {
      const badge = achievementById(fresh[0])!;
      const rewards = rewardsFor(badge.id);
      toast(
        rewards.length
          ? t('New badge: {badge}. You unlocked {rewards}.', { badge: badge.title, rewards: listWords(rewards.length > 3 ? [...rewards.slice(0, 2), plural(rewards.length - 2, { one: '{n} more', other: '{n} more' })] : rewards) })
          : t('New badge: {badge} — {how}', { badge: badge.title, how: badge.description }),
        badge.emoji,
      );
    } else if (fresh.length > 1) {
      toast(plural(fresh.length, { one: '{n} new badge — see it on Insights', other: '{n} new badges — see them on Insights' }), '🏅');
    }
  }, [unlocked, toast]);

  return null;
}
