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
import { t, uiLanguage, uiLocale } from './i18n';

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

/** A list in words, the way their language joins one: "a, b and c", "a, b y c". */
export function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  try {
    return new Intl.ListFormat(uiLocale(), { style: 'long', type: 'conjunction' }).format(words);
  } catch {
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  }
}

/** Lower-case the first letter mid-sentence — in English only: German capitalises its nouns. */
const midSentence = (name: string) => (uiLanguage() === 'en' ? name.charAt(0).toLowerCase() + name.slice(1) : name);

export function packContents(pack: Pack): PackContents {
  const items = ACCESSORIES.filter(inPack(pack));
  const scenes = SCENES.filter(inPack(pack));
  const look: Outfit = {};
  for (const { id } of SLOTS) {
    const first = items.find((item) => item.slot === id);
    if (first) look[id] = first.id;
  }
  // Only the first word keeps its capital: "Chef's hat and neckerchief".
  const names = [...items.map((item) => item.name), ...scenes.map((scene) => t('the {name} scene', { name: scene.name }))].map((name, i) =>
    i === 0 || name.startsWith('the ') ? name : midSentence(name),
  );
  return { pack, name: PACKS[pack], items, scenes, look, words: listWords(names), count: items.length + scenes.length };
}

/** Every pack, in catalogue order. */
export const ALL_PACKS: PackContents[] = (Object.keys(PACKS) as Pack[]).map(packContents);

/** The packs with something in this list — the wardrobe's packs, or the scene picker's. */
export function packsAmong(things: { unlock: { kind: string; pack?: Pack } }[]): PackContents[] {
  return ALL_PACKS.filter((contents) => things.some((thing) => thing.unlock.kind === 'pack' && thing.unlock.pack === contents.pack));
}

export const packLocked = (contents: PackContents): string =>
  t('The {pack} — {contents} — is not on sale yet.', { pack: contents.name, contents: midSentence(contents.words) });
