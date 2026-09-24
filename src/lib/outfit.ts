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

export type Slot = 'head' | 'face' | 'neck';

export const SLOTS: { id: Slot; name: string }[] = [
  { id: 'head', name: 'Head' },
  { id: 'face', name: 'Face' },
  { id: 'neck', name: 'Neck' },
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
  | { kind: 'season'; season: Season };

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
  chef: 'Chef pack',
  sporty: 'Sporty pack',
  cosy: 'Cosy pack',
};

/**
 * When each season's items are out, as [month, day] inclusive, in local time.
 * New Year runs over the turn of the year, which `inSeason` handles.
 */
export const SEASONS: Record<Season, { name: string; from: [number, number]; to: [number, number] }> = {
  winter: { name: 'Winter', from: [12, 1], to: [12, 31] },
  'new-year': { name: 'New Year', from: [12, 26], to: [1, 7] },
  valentines: { name: 'Valentine’s', from: [2, 1], to: [2, 14] },
  spring: { name: 'Spring', from: [3, 20], to: [4, 30] },
  summer: { name: 'Summer', from: [6, 21], to: [8, 31] },
  halloween: { name: 'Halloween', from: [10, 15], to: [10, 31] },
};

const earned = (id: string, how: string) => ({ unlock: { kind: 'achievement', id } as const, how });
const plus = { unlock: { kind: 'subscriber' } as const, how: 'Comes with Squish Plus' };
const pack = (p: Pack) => ({ unlock: { kind: 'pack', pack: p } as const, how: PACKS[p] });
const season = (s: Season) => ({ unlock: { kind: 'season', season: s } as const, how: `${SEASONS[s].name}, with Squish Plus` });

/** In the order the picker shows them: earned first, then Plus, then packs. */
export const ACCESSORIES: Accessory[] = [
  { id: 'party-hat', name: 'Party hat', slot: 'head', ...earned('first-meal', 'Log your first meal'), rise: 53 },
  { id: 'round-specs', name: 'Round glasses', slot: 'face', ...earned('streak-3', 'Three days running') },
  { id: 'knit-scarf', name: 'Knitted scarf', slot: 'neck', ...earned('streak-7', 'A full week of logging') },
  { id: 'crown', name: 'Little crown', slot: 'head', ...plus, rise: 29 },
  { id: 'heart-shades', name: 'Heart sunglasses', slot: 'face', ...plus },
  { id: 'headphones', name: 'Headphones', slot: 'head', ...plus },
  { id: 'chef-hat', name: 'Chef’s hat', slot: 'head', ...pack('chef'), rise: 61 },
  { id: 'neckerchief', name: 'Neckerchief', slot: 'neck', ...pack('chef') },
  { id: 'sweatband', name: 'Sweatband', slot: 'head', ...pack('sporty') },
  { id: 'medal', name: 'Medal', slot: 'neck', ...pack('sporty') },
  { id: 'beanie', name: 'Bobble beanie', slot: 'head', ...pack('cosy'), rise: 5 },
  { id: 'earmuffs', name: 'Earmuffs', slot: 'head', ...pack('cosy') },
  { id: 'santa-hat', name: 'Santa hat', slot: 'head', ...season('winter'), rise: 43 },
  { id: 'reindeer-antlers', name: 'Reindeer antlers', slot: 'head', ...season('winter'), rise: 51 },
  { id: 'glitter-glasses', name: 'Glitter glasses', slot: 'face', ...season('new-year') },
  { id: 'heart-antennae', name: 'Heart antennae', slot: 'head', ...season('valentines'), rise: 43 },
  { id: 'bunny-ears', name: 'Bunny ears', slot: 'head', ...season('spring'), rise: 50 },
  { id: 'straw-sun-hat', name: 'Straw sun hat', slot: 'head', ...season('summer') },
  { id: 'pumpkin-hat', name: 'Pumpkin hat', slot: 'head', ...season('halloween'), rise: 12 },
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

/** Can this person wear this item today? */
export function canWear(item: Accessory, { unlocked, subscribed, today }: Entitlement): boolean {
  switch (item.unlock.kind) {
    case 'achievement':
      return Boolean(unlocked[item.unlock.id]);
    case 'subscriber':
      return subscribed;
    case 'pack':
      // Nothing is on sale yet, so nobody owns a pack.
      return false;
    case 'season':
      return subscribed && inSeason(item.unlock.season, today);
  }
}

/** Whether the picker should list it at all: a season's items only in season. */
export function onShow(item: Accessory, today: Date): boolean {
  return item.unlock.kind !== 'season' || inSeason(item.unlock.season, today);
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
