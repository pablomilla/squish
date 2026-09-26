/**
 * Home scenes: a place behind Squish on the Home card, instead of the flat
 * lavender.
 *
 * Each is a light and a dark picture of the same place (dusk and night, not
 * inverted colours), drawn at 1344 × 690 — three times the largest card —
 * with everything interesting on the right, behind Squish, and the left 55%
 * kept quiet for the speech bubble and the handwritten line. The card shows
 * it like `background-size: cover` pinned to the bottom right, so a smaller
 * card loses sky and quiet zone and never the scenery.
 *
 * They are come by the same ways as accessories (`lib/outfit.ts`), and the
 * same check runs at every render: a scene somebody may no longer use — Plus
 * lapsed, season over — quietly goes back to lavender, and comes back if
 * they do.
 */
import { entitled, onShow, SEASONS, type Entitlement, type ItemUnlock, type Pack, type Season } from './outfit';

export interface Scene {
  id: string;
  name: string;
  unlock: ItemUnlock;
  how: string;
}

const earned = (id: string, how: string) => ({ unlock: { kind: 'achievement', id } as const, how });
const plus = { unlock: { kind: 'subscriber' } as const, how: 'Comes with Squish Plus' };
const pack = (p: Pack, name: string) => ({ unlock: { kind: 'pack', pack: p } as const, how: name });
const season = (s: Season) => ({ unlock: { kind: 'season', season: s } as const, how: `${SEASONS[s].name}, with Squish Plus` });

export const SCENES: Scene[] = [
  { id: 'kitchen', name: 'Morning kitchen', ...earned('streak-14', 'Two weeks of logging') },
  { id: 'picnic', name: 'Park picnic', ...earned('streak-30', 'Thirty days of logging') },
  // Back from a holiday, or just back: the reward for returning after a week or more away.
  { id: 'beach', name: 'Beach day', ...earned('welcome-back', 'Come back after a week away') },
  { id: 'stars', name: 'Starry night', ...plus },
  { id: 'space', name: 'Space', ...plus },
  { id: 'rainy-window', name: 'Rainy window', ...pack('cosy', 'Cosy pack') },
  { id: 'snowy-village', name: 'Snowy village', ...season('winter') },
  { id: 'fireworks-city', name: 'Fireworks', ...season('new-year') },
  { id: 'sweet-shop', name: 'Sweet shop', ...season('valentines') },
  { id: 'blossom-garden', name: 'Blossom garden', ...season('spring') },
  { id: 'ice-lolly-stand', name: 'Ice-lolly stand', ...season('summer') },
  { id: 'pumpkin-patch', name: 'Pumpkin patch', ...season('halloween') },
];

export const sceneById = (id: string | undefined): Scene | undefined => (id ? SCENES.find((s) => s.id === id) : undefined);

export const canUseScene = (scene: Scene, entitlement: Entitlement): boolean => entitled(scene.unlock, entitlement);

/** Seasonal scenes are only listed in season, like seasonal accessories. */
export const sceneOnShow = (scene: Scene, today: Date): boolean => onShow(scene, today);

/** The scene to show, or none: what they chose, if they may still have it. */
export function sceneInUse(chosen: string | undefined, entitlement: Entitlement): Scene | undefined {
  const scene = sceneById(chosen);
  return scene && canUseScene(scene, entitlement) ? scene : undefined;
}
