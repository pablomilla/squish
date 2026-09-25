/**
 * Packs as bundles: what is in each, gathered from the wardrobe and the
 * scenes, so a picker can offer "Chef pack — chef's hat and neckerchief" as
 * one thing rather than two loose items with a small grey label each.
 *
 * Which items belong to which pack stays where it always was, on the items
 * themselves (`lib/outfit.ts`, `lib/scenes.ts`). This only reads it.
 */
import { ACCESSORIES, PACKS, SLOTS, type Accessory, type Outfit, type Pack } from './outfit';
import { SCENES, type Scene } from './scenes';

export interface PackContents {
  pack: Pack;
  name: string;
  items: Accessory[];
  scenes: Scene[];
  /** Squish in the pack: its first item for each slot. */
  look: Outfit;
  /** "Chef's hat and neckerchief", "Bobble beanie, earmuffs and the Rainy window scene". */
  words: string;
  count: number;
}

const inPack = (pack: Pack) => (thing: { unlock: { kind: string; pack?: Pack } }) =>
  thing.unlock.kind === 'pack' && thing.unlock.pack === pack;

/** A list in words: "a", "a and b", "a, b and c". */
export function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export function packContents(pack: Pack): PackContents {
  const items = ACCESSORIES.filter(inPack(pack));
  const scenes = SCENES.filter(inPack(pack));
  const look: Outfit = {};
  for (const { id } of SLOTS) {
    const first = items.find((item) => item.slot === id);
    if (first) look[id] = first.id;
  }
  // Only the first word keeps its capital: "Chef's hat and neckerchief".
  const names = [...items.map((item) => item.name), ...scenes.map((scene) => `the ${scene.name} scene`)].map((name, i) =>
    i === 0 || name.startsWith('the ') ? name : name.charAt(0).toLowerCase() + name.slice(1),
  );
  return { pack, name: PACKS[pack], items, scenes, look, words: listWords(names), count: items.length + scenes.length };
}

/** Every pack, in catalogue order. */
export const ALL_PACKS: PackContents[] = (Object.keys(PACKS) as Pack[]).map(packContents);

/** The packs with something in this list — the wardrobe's packs, or the scene picker's. */
export function packsAmong(things: { unlock: { kind: string; pack?: Pack } }[]): PackContents[] {
  return ALL_PACKS.filter((contents) => things.some((thing) => thing.unlock.kind === 'pack' && thing.unlock.pack === contents.pack));
}

export const packLocked = (contents: PackContents): string => `The ${contents.name} — ${contents.words.charAt(0).toLowerCase()}${contents.words.slice(1)} — is not on sale yet.`;
