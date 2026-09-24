/**
 * The share card's frames, stickers and badges: addresses for thumbnails in
 * the sheet, and the markup itself — fetched only when a card uses it — for
 * drawing onto the canvas. The card rasterises SVG from a data URL, as it
 * does the mascot, so nothing it draws can taint the canvas.
 */
import { isBadge } from '../lib/shareDecor';

const urls = import.meta.glob<string>('../assets/share/*/*.svg', { query: '?url', import: 'default', eager: true });
const markup = import.meta.glob<string>('../assets/share/*/*.svg', { query: '?raw', import: 'default' });

const path = (kind: 'frames' | 'stickers', id: string) =>
  `../assets/share/${kind === 'stickers' && isBadge(id) ? 'badges' : kind}/${id}.svg`;

export const frameUrl = (id: string): string | undefined => urls[path('frames', id)];
export const stickerUrl = (id: string): string | undefined => urls[path('stickers', id)];

export async function frameMarkup(id: string): Promise<string | undefined> {
  return markup[path('frames', id)]?.();
}

export async function stickerMarkup(id: string): Promise<string | undefined> {
  return markup[path('stickers', id)]?.();
}
