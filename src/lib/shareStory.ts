/**
 * What a share card says, for wherever it is made from — Insights or You.
 *
 * It used to exist only for a streak of two or more, which meant the share
 * sheet (and every frame and sticker in it) was invisible to anybody just
 * starting. Now there is a card for every point: nothing logged yet, day
 * one, a streak, or coming back after one ended. None of them shows a row of
 * zeros — a card with nothing to boast about says something kind instead.
 */
import type { Mood } from '../types';
import type { RangeSummary } from './selectors';

/** What a card says. Kept here, away from the canvas code, so tests can use it. */
export interface ShareCardData {
  /** The one thing the card is about: "9 day streak". */
  headline: string;
  subline: string;
  /** Up to three supporting figures. */
  stats: { label: string; value: string }[];
  mood: Mood;
}

export interface ShareStory {
  streak: number;
  best: number;
  mealCount: number;
  summary: Pick<RangeSummary, 'days' | 'loggedDays' | 'avgCalories' | 'avgScore'>;
}

export function shareStory({ streak, best, mealCount, summary }: ShareStory): ShareCardData {
  const logged =
    summary.loggedDays > 0
      ? `${summary.loggedDays} of the last ${summary.days} days logged, averaging ${summary.avgCalories} kcal.`
      : 'Every day counts.';

  if (streak >= 2) {
    return {
      headline: `${streak} day streak`,
      subline: logged,
      stats: [
        { label: 'best streak', value: `${best}` },
        { label: 'avg quality', value: `${summary.avgScore}` },
        { label: 'meals logged', value: `${mealCount}` },
      ],
      mood: 'cheering',
    };
  }

  if (mealCount === 0) {
    return { headline: 'Starting with Squish', subline: 'Me and my little health buddy, from today.', stats: [], mood: 'excited' };
  }

  if (streak === 1) {
    return {
      headline: 'Day one',
      subline: 'Every streak starts with a single day.',
      stats: [
        { label: mealCount === 1 ? 'meal logged' : 'meals logged', value: `${mealCount}` },
        ...(summary.avgScore > 0 ? [{ label: 'avg quality', value: `${summary.avgScore}` }] : []),
      ],
      mood: 'excited',
    };
  }

  // Meals in the diary, but no streak running: back for another go.
  return {
    headline: 'Back with Squish',
    subline: logged,
    stats: [
      { label: 'best streak', value: `${best}` },
      { label: 'meals logged', value: `${mealCount}` },
    ],
    mood: 'excited',
  };
}
