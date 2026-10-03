/**
 * What makes a good food photo, said the same wherever a camera opens: the
 * meal camera (src/screens/Capture.tsx) and a quick snap (QuickSnap.tsx).
 */
import { t } from './i18n';

/** Under the frame: the one thing that matters most. */
export const PLATE_GUIDE = t('Whole plate in the frame — the rim is what Squish measures against.');

/** Behind the help button. */
export const FOOD_TIPS: [string, string][] = [
  ['🔆', t('Good light beats a good camera. Near a window is ideal; overhead kitchen light is fine.')],
  ['🍽️', t('Get the whole plate in frame. Anything cropped out is nutrition I cannot count.')],
  ['📐', t('Shoot from slightly above, at an angle — straight down hides how deep a bowl is.')],
  ['🥄', t('Leave a fork or hand in shot. It tells me the scale, and portions are half the answer.')],
  ['🫙', t('Dressings, oil and sauces are invisible. Mention them after, and I will add them in.')],
];
