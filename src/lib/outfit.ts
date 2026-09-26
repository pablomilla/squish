/**
 * What Squish wears.
 *
 * Three slots, one item in each: something on the head, something on the
 * face, something round the neck. A beanie, glasses and a scarf together is
 * fine; two hats is not, and the picker swaps rather than refuses.
 *
 * The artwork arrives already fitted to all seven poses (see
 * scripts/build-accessories.ts), as a layer behind the body and a layer in
 * front. `dress` threads those into a pose so that the body covers a hat's
 * back brim, the watermelon covers a scarf, and a cheering Squish's arms go
 * in front of everything.
 *
 * How an item is come by follows the looks: earned against achievements the
 * app already tracks, or part of Plus. Two kinds are new. Packs are bought
 * once — not on sale anywhere yet, so they show and say so. Seasonal items
 * come with Plus while their season is on, and go back in the box after.
 * Keeping one for good once the season ends needs somebody to have bought
 * it, and that needs a record on the server rather than a line in
 * localStorage, so it waits for purchases to exist.
 */
import type { Mood } from '../types';
import { t } from './i18n';

export type Slot = 'head' | 'face' | 'neck';

export const SLOTS: { id: Slot; name: string }[] = [
  { id: 'head', name: t('Head') },
  { id: 'face', name: t('Face') },
  { id: 'neck', name: t('Neck') },
];

/** One layer per pose, as SVG markup in the pose's own 512 space. */
export interface AccessoryArt {
  back: Record<Mood, string>;
  front: Record<Mood, string>;
}

export type Season = 'winter' | 'new-year' | 'valentines' | 'spring' | 'summer' | 'halloween';
export type Pack = 'chef' | 'sporty' | 'cosy';

export type ItemUnlock =
  | { kind: 'achievement'; id: string }
  | { kind: 'subscriber' }
  | { kind: 'pack'; pack: Pack }
  | { kind: 'season'; season: Season; free?: boolean };

export interface Accessory {
  id: string;
  name: string;
  slot: Slot;
  unlock: ItemUnlock;
  /** How it is come by, for a locked tile. */
  how: string;
  /**
   * How far above the mascot's crop box (in the 512 artwork space) the
   * item reaches in its tallest pose, with a little air. On screen a hat
   * simply draws past the box; a share card is rasterised to the box, so it
   * is grown by this much to keep the top of a chef's hat on the picture.
   * Measured in a browser from the fitted artwork.
   */
  rise?: number;
}

export const PACKS: Record<Pack, string> = {
  chef: t('Chef pack'),
  sporty: t('Sporty pack'),
  cosy: t('Cosy pack'),
};

/**
 * When each season's items are out, as [month, day] inclusive, in local time.
 * New Year runs over the turn of the year, which `inSeason` handles.
 */
export const SEASONS: Record<Season, { name: string; from: [number, number]; to: [number, number] }> = {
  winter: { name: t('Winter'), from: [12, 1], to: [12, 31] },
  'new-year': { name: t('New Year'), from: [12, 26], to: [1, 7] },
  valentines: { name: t('Valentine’s'), from: [2, 1], to: [2, 14] },
  spring: { name: t('Spring'), from: [3, 20], to: [4, 30] },
  summer: { name: t('Summer'), from: [6, 21], to: [8, 31] },
  halloween: { name: t('Halloween'), from: [10, 15], to: [10, 31] },
};

const earned = (id: string, how: string) => ({ unlock: { kind: 'achievement', id } as const, how });
const plus = { unlock: { kind: 'subscriber' } as const, how: t('Comes with Squish Plus') };
const pack = (p: Pack) => ({ unlock: { kind: 'pack', pack: p } as const, how: PACKS[p] });
const season = (s: Season) => ({ unlock: { kind: 'season', season: s } as const, how: t('{season}, with Squish Plus', { season: SEASONS[s].name }) });

/** In the order the picker shows them: earned first, then Plus, then packs. */
export const ACCESSORIES: Accessory[] = [
  { id: 'party-hat', name: t('Party hat'), slot: 'head', ...earned('first-meal', t('Log your first meal')), rise: 53 },
  { id: 'round-specs', name: t('Round glasses'), slot: 'face', ...earned('streak-3', t('Three days running')) },
  { id: 'knit-scarf', name: t('Knitted scarf'), slot: 'neck', ...earned('streak-7', t('A full week of logging')) },
  // Only ever earned, never sold: the thank-you for inviting a friend who got going.
  { id: 'squad-cap', name: t('Squad cap'), slot: 'head', ...earned('squad', t('Invite a friend who gets going')), rise: 11 },
  { id: 'crown', name: t('Little crown'), slot: 'head', ...plus, rise: 29 },
  { id: 'heart-shades', name: t('Heart sunglasses'), slot: 'face', ...plus },
  { id: 'headphones', name: t('Headphones'), slot: 'head', ...earned('days-50', t('Log on fifty days, any fifty')) },
  { id: 'chef-hat', name: t('Chef’s hat'), slot: 'head', ...pack('chef'), rise: 61 },
  { id: 'neckerchief', name: t('Neckerchief'), slot: 'neck', ...pack('chef') },
  { id: 'sweatband', name: t('Sweatband'), slot: 'head', ...pack('sporty') },
  { id: 'medal', name: t('Medal'), slot: 'neck', ...pack('sporty') },
  { id: 'beanie', name: t('Bobble beanie'), slot: 'head', ...pack('cosy'), rise: 5 },
  { id: 'earmuffs', name: t('Earmuffs'), slot: 'head', ...pack('cosy') },
  { id: 'santa-hat', name: t('Santa hat'), slot: 'head', ...season('winter'), rise: 43 },
  { id: 'reindeer-antlers', name: t('Reindeer antlers'), slot: 'head', ...season('winter'), rise: 51 },
  { id: 'glitter-glasses', name: t('Glitter glasses'), slot: 'face', ...season('new-year') },
  { id: 'heart-antennae', name: t('Heart antennae'), slot: 'head', ...season('valentines'), rise: 43 },
  { id: 'bunny-ears', name: t('Bunny ears'), slot: 'head', ...season('spring'), rise: 50 },
  { id: 'straw-sun-hat', name: t('Straw sun hat'), slot: 'head', ...season('summer') },
  { id: 'pumpkin-hat', name: t('Pumpkin hat'), slot: 'head', ...season('halloween'), rise: 12 },
];

export const accessoryById = (id: string | undefined): Accessory | undefined =>
  id ? ACCESSORIES.find((item) => item.id === id) : undefined;

/** The headroom a worn outfit needs on a share card, in artwork units. */
export const riseOf = (outfit: Outfit): number => accessoryById(outfit.head)?.rise ?? 0;

/** What somebody has chosen to wear, one item per slot at most. */
export type Outfit = Partial<Record<Slot, string>>;

/** Whether `date` (local) falls inside the season, wrapping over New Year. */
export function inSeason(which: Season, date: Date): boolean {
  const { from, to } = SEASONS[which];
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const start = from[0] * 100 + from[1];
  const end = to[0] * 100 + to[1];
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

export interface Entitlement {
  /** Achievement ids to the date they were reached, as the store keeps them. */
  unlocked: Record<string, string>;
  subscribed: boolean;
  today: Date;
}

/** Whether somebody has what an unlock asks for, today. Shared with Home scenes. */
export function entitled(unlock: ItemUnlock, { unlocked, subscribed, today }: Entitlement): boolean {
  switch (unlock.kind) {
    case 'achievement':
      return Boolean(unlocked[unlock.id]);
    case 'subscriber':
      return subscribed;
    case 'pack':
      // Nothing is on sale yet, so nobody owns a pack.
      return false;
    case 'season':
      // Seasonal stickers are a treat for everybody; the rest come with Plus.
      return (unlock.free || subscribed) && inSeason(unlock.season, today);
  }
}

/** Can this person wear this item today? */
export const canWear = (item: Accessory, entitlement: Entitlement): boolean => entitled(item.unlock, entitlement);

/** Whether a picker should list it at all: a season's things only in season. */
export function onShow(item: { unlock: ItemUnlock }, today: Date): boolean {
  return item.unlock.kind !== 'season' || inSeason(item.unlock.season, today);
}

/** The words for a locked tile's toast. */
export function whyLocked(item: { name: string; how: string; unlock: ItemUnlock }, plus: string): string {
  switch (item.unlock.kind) {
    case 'achievement':
      return item.how;
    case 'pack':
      return t('{item} is in the {pack}, which is not on sale yet.', { item: item.name, pack: PACKS[item.unlock.pack] });
    default:
      return t('{item} comes with {plus}, which is not on sale yet.', { item: item.name, plus });
  }
}

/**
 * The part of an outfit somebody may actually wear right now.
 *
 * Checked at every render rather than when the item is put on, so a lapsed
 * subscription or a season ending takes the crown off without anything
 * having to notice and tidy up. The choice itself is kept: if Plus comes
 * back, so does the crown.
 */
export function wearable(outfit: Outfit | undefined, entitlement: Entitlement): Outfit {
  const worn: Outfit = {};
  for (const { id: slot } of SLOTS) {
    const item = accessoryById(outfit?.[slot]);
    if (item && item.slot === slot && canWear(item, entitlement)) worn[slot] = item.id;
  }
  return worn;
}

/** Put an item on, or take it off if it is already on. */
export function toggle(outfit: Outfit | undefined, item: Accessory): Outfit {
  const next = { ...outfit };
  if (next[item.slot] === item.id) delete next[item.slot];
  else next[item.slot] = item.id;
  return next;
}

/**
 * Thread accessory layers into a pose's markup.
 *
 * The pose is drawn inside a group that scales it down (`translate(x 44)
 * scale(.65)`), while the accessories are drawn in the outer 512 space the
 * designer measured. So each layer is wrapped in the inverse of the pose's
 * transform, which puts it back where it was drawn.
 *
 * Order, bottom to top: shadow, every item's back, body, face, the face
 * item, the neck item, props, the head item, arms, accents. Neck goes under
 * props so nomnom's watermelon covers the scarf; the head item goes under
 * the arms so raised hands stay in front of a brim.
 */
export function dress(markup: string, mood: Mood, layers: Partial<Record<Slot, AccessoryArt>>): string {
  const present = SLOTS.filter(({ id }) => layers[id]);
  if (present.length === 0) return markup;

  const placed = markup.match(/<g id="__ID__squish-[a-z]+" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)"/);
  if (!placed) return markup;
  const [x, y, s] = placed.slice(1).map(Number);
  const wrap = (inner: string) => (inner ? `<g transform="scale(${+(1 / s).toFixed(6)}) translate(${-x} ${-y})">${inner}</g>` : '');

  const back = wrap(present.map(({ id }) => layers[id]!.back[mood]).join(''));
  const front = (slot: Slot) => wrap(layers[slot]?.front[mood] ?? '');

  const before = (html: string, layer: string, insert: string) => {
    const at = html.indexOf(`<g id="__ID__${layer}"`);
    return at < 0 || !insert ? html : html.slice(0, at) + insert + html.slice(at);
  };

  let out = before(markup, 'body', back);
  out = before(out, 'props', front('face') + front('neck'));
  out = before(out, 'arms', front('head'));
  return out;
}

/**
 * A picker's items, sorted by how somebody gets them rather than mixed
 * together: what is already theirs first, then what they can earn, then
 * Plus, then each pack under its own name. Every tile can then say what it
 * is, with how to get it said once in the heading above.
 */
export type ShelfKind = 'yours' | 'earn' | 'plus' | 'pack';

export interface Shelf<T> {
  key: string;
  kind: ShelfKind;
  title: string;
  items: T[];
}

export function shelves<T extends { unlock: ItemUnlock }>(items: T[], entitlement: Entitlement): Shelf<T>[] {
  const yours: T[] = [];
  const earn: T[] = [];
  const plus: T[] = [];
  const packs: T[] = [];
  for (const item of items) {
    if (entitled(item.unlock, entitlement)) yours.push(item);
    else if (item.unlock.kind === 'achievement') earn.push(item);
    else if (item.unlock.kind === 'pack') packs.push(item);
    else plus.push(item);
  }
  // Packs together, each pack's items side by side.
  const packOrder = Object.keys(PACKS);
  const packOf = (item: T) => (item.unlock.kind === 'pack' ? packOrder.indexOf(item.unlock.pack) : 0);
  packs.sort((a, b) => packOf(a) - packOf(b));

  const all: Shelf<T>[] = [
    { key: 'yours', kind: 'yours', title: t('Yours'), items: yours },
    { key: 'earn', kind: 'earn', title: t('Earn these'), items: earn },
    { key: 'plus', kind: 'plus', title: t('With Squish Plus'), items: plus },
    { key: 'packs', kind: 'pack', title: t('Packs'), items: packs },
  ];
  return all.filter((shelf) => shelf.items.length > 0);
}

/**
 * The second line under an item's name — only where the heading does not
 * already say it: which season, or which pack. Plus items need nothing more
 * than their heading, and earned ones say what to do (their `how`).
 */
export function lockedNote(unlock: ItemUnlock): string {
  if (unlock.kind === 'season') return t('{season} only', { season: SEASONS[unlock.season].name });
  if (unlock.kind === 'pack') return PACKS[unlock.pack];
  return '';
}
