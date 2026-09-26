/**
 * Frames and stickers for the share card.
 *
 * The card's layout is fixed (`lib/share.ts`), so decoration only goes where
 * the designer was told it could: a frame lives in the outer 64px band and
 * the corners, and stickers sit in the two slots either side of Squish.
 * Neither can cover the words, the figures or the wordmark.
 *
 * One frame, and up to two stickers — the first on the left of Squish, the
 * second on the right. Streak badges are stickers too, earned at 7, 30, 100
 * and 365 days.
 *
 * How each is come by follows accessories and scenes (`lib/outfit.ts`), with
 * one difference the brief asked for: a season's stickers are free for
 * everybody while it lasts, as a treat. Its frame comes with Plus.
 */
import { entitled, onShow, SEASONS, type Entitlement, type ItemUnlock, type Season } from './outfit';
import { t } from './i18n';

export interface Decoration {
  id: string;
  name: string;
  unlock: ItemUnlock;
  how: string;
}

export interface ShareDecor {
  frame: string;
  stickers: string[];
}

/** Stickers on one card, at most. */
export const MAX_STICKERS = 2;

const earned = (id: string, how: string) => ({ unlock: { kind: 'achievement', id } as const, how });
const plus = { unlock: { kind: 'subscriber' } as const, how: t('Comes with Squish Plus') };
const seasonPlus = (s: Season) => ({ unlock: { kind: 'season', season: s } as const, how: t('{season}, with Squish Plus', { season: SEASONS[s].name }) });
const seasonFree = (s: Season) => ({ unlock: { kind: 'season', season: s, free: true } as const, how: t('{season} only', { season: SEASONS[s].name }) });

export const FRAMES: Decoration[] = [
  { id: 'scallop', name: t('Scallop'), ...earned('first-share', t('Share a card once')) },
  { id: 'confetti', name: t('Confetti'), ...earned('streak-7', t('A full week of logging')) },
  { id: 'squad', name: t('Squad'), ...earned('squad', t('Invite a friend who gets going')) },
  { id: 'botanical', name: t('Botanical'), ...plus },
  { id: 'gold-foil', name: t('Gold foil'), ...plus },
  { id: 'snowflake', name: t('Snowflakes'), ...seasonPlus('winter') },
  { id: 'starburst', name: t('Starburst'), ...seasonPlus('new-year') },
  { id: 'hearts', name: t('Hearts'), ...seasonPlus('valentines') },
  { id: 'blossom', name: t('Blossom'), ...seasonPlus('spring') },
  { id: 'citrus', name: t('Citrus'), ...seasonPlus('summer') },
  { id: 'bats', name: t('Bats'), ...seasonPlus('halloween') },
];

/**
 * The eight earned stickers are spread over achievements the app already
 * awards, so there is always another one coming — and, as with everything
 * else earned, none of them rewards eating more.
 */
export const STICKERS: Decoration[] = [
  { id: 'strawberry', name: t('Strawberry'), ...earned('first-meal', t('Log your first meal')) },
  { id: 'avocado', name: t('Avocado'), ...earned('first-meal', t('Log your first meal')) },
  { id: 'carrot', name: t('Carrot'), ...earned('first-meal', t('Log your first meal')) },
  { id: 'heart', name: t('Heart'), ...earned('streak-3', t('Three days running')) },
  { id: 'water-glass', name: t('Water'), ...earned('hydrated', t('Reach your water goal')) },
  { id: 'sun', name: t('Sunshine'), ...earned('fibre-hit', t('Hit your fibre target')) },
  { id: 'star', name: t('Star'), ...earned('balanced-day', t('A day scoring 75+')) },
  { id: 'thumbs-up', name: t('Thumbs up'), ...earned('streak-7', t('A full week of logging')) },
  { id: 'sparkles', name: t('Sparkles'), ...plus },
  { id: 'rainbow', name: t('Rainbow'), ...plus },
  { id: 'go-me', name: t('“Go me!”'), ...plus },
  { id: 'squished-it', name: t('“Squished it!”'), ...plus },
  { id: 'streak-7', name: t('7-day badge'), ...earned('streak-7', t('A full week of logging')) },
  { id: 'streak-30', name: t('30-day badge'), ...earned('streak-30', t('Thirty days of logging')) },
  { id: 'streak-100', name: t('100-day badge'), ...earned('streak-100', t('A hundred days of logging')) },
  { id: 'streak-365', name: t('365-day badge'), ...earned('streak-365', t('A year of logging')) },
  { id: 'squad-badge', name: t('Squad badge'), ...earned('squad', t('Invite a friend who gets going')) },
  { id: 'mug', name: t('Hot chocolate'), ...seasonFree('winter') },
  { id: 'gingerbread', name: t('Gingerbread'), ...seasonFree('winter') },
  { id: 'snowflake', name: t('Snowflake'), ...seasonFree('winter') },
  { id: 'party-popper', name: t('Party popper'), ...seasonFree('new-year') },
  { id: 'midnight-clock', name: t('Midnight'), ...seasonFree('new-year') },
  { id: 'new-me-same-me', name: t('“New me? Same me!”'), ...seasonFree('new-year') },
  { id: 'love-letter', name: t('Love letter'), ...seasonFree('valentines') },
  { id: 'strawberry-heart', name: t('Strawberry heart'), ...seasonFree('valentines') },
  { id: 'youre-a-treat', name: t('“You’re a treat”'), ...seasonFree('valentines') },
  { id: 'chick', name: t('Chick'), ...seasonFree('spring') },
  { id: 'tulip', name: t('Tulip'), ...seasonFree('spring') },
  { id: 'egg', name: t('Egg'), ...seasonFree('spring') },
  { id: 'ice-lolly', name: t('Ice lolly'), ...seasonFree('summer') },
  { id: 'watermelon-slice', name: t('Watermelon'), ...seasonFree('summer') },
  { id: 'sunglasses', name: t('Sunglasses'), ...seasonFree('summer') },
  { id: 'friendly-ghost', name: t('Friendly ghost'), ...seasonFree('halloween') },
  { id: 'pumpkin', name: t('Pumpkin'), ...seasonFree('halloween') },
  { id: 'sweets', name: t('Sweets'), ...seasonFree('halloween') },
];

/** Streak badges live with the stickers but are drawn from their own folder. */
export const isBadge = (id: string): boolean => /^streak-\d+$/.test(id);

export const frameById = (id: string | undefined) => (id ? FRAMES.find((f) => f.id === id) : undefined);
export const stickerById = (id: string | undefined) => (id ? STICKERS.find((s) => s.id === id) : undefined);

export const canUse = (item: Decoration, entitlement: Entitlement): boolean => entitled(item.unlock, entitlement);
export const decorOnShow = (item: Decoration, today: Date): boolean => onShow(item, today);

/**
 * What actually goes on the card: the chosen frame and stickers that exist
 * and that this person may use today, stickers capped at two with no repeats.
 */
export function usableDecor(chosen: Partial<ShareDecor> | undefined, entitlement: Entitlement): ShareDecor {
  const frame = frameById(chosen?.frame);
  const stickers = [...new Set(Array.isArray(chosen?.stickers) ? chosen.stickers : [])]
    .map(stickerById)
    .filter((s): s is Decoration => Boolean(s) && canUse(s!, entitlement))
    .slice(0, MAX_STICKERS)
    .map((s) => s.id);
  return { frame: frame && canUse(frame, entitlement) ? frame.id : '', stickers };
}

/**
 * Tap a sticker: off if it is on; on if there is room; otherwise it replaces
 * the older of the two, which is what somebody tapping a third one means.
 */
export function toggleSticker(stickers: string[], id: string): string[] {
  if (stickers.includes(id)) return stickers.filter((s) => s !== id);
  const next = [...stickers, id];
  return next.slice(-MAX_STICKERS);
}
