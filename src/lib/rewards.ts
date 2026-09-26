/**
 * What each badge unlocks elsewhere in the app: a look, something to wear, a
 * Home scene, a frame or a sticker for the share card.
 *
 * Read from the catalogues themselves rather than listed again here, so a
 * badge can never claim a reward its item no longer gives. Shown on the badge
 * in Insights, and in the toast that announces it, because an unlock nobody
 * is told about is an unlock nobody goes looking for.
 */
import { LOOKS, PLUS_LOOKS } from './looks';
import { ACCESSORIES } from './outfit';
import { SCENES } from './scenes';
import { FRAMES, STICKERS } from './shareDecor';
import { listWords } from './packs';

type Unlockable = { name: string; unlock: { kind: string; id?: string } };

const earnedBy = (achievement: string) => (item: Unlockable) => item.unlock.kind === 'achievement' && item.unlock.id === achievement;

/** Short names for what this badge unlocks, in a sensible order: Squish first, then Home, then the card. */
export function rewardsFor(achievement: string): string[] {
  const test = earnedBy(achievement);
  return [
    ...([...LOOKS, ...PLUS_LOOKS] as Unlockable[]).filter(test).map((look) => `the ${look.name} look`),
    ...ACCESSORIES.filter(test).map((item) => item.name),
    ...SCENES.filter(test).map((scene) => `the ${scene.name} scene`),
    ...FRAMES.filter(test).map((frame) => `the ${frame.name} frame`),
    ...STICKERS.filter(test).map((sticker) => `the ${sticker.name} sticker`),
  ];
}

/** "Unlocks Headphones", "Unlocks the Peach look, Party hat and 3 more" — or nothing. */
export function unlocksLine(achievement: string): string {
  const rewards = rewardsFor(achievement);
  if (!rewards.length) return '';
  const shown = rewards.length > 3 ? [...rewards.slice(0, 2), `${rewards.length - 2} more`] : rewards;
  return `Unlocks ${listWords(shown)}`;
}
