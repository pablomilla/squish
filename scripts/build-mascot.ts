/**
 * Turn the delivered mascot artwork into the markup the app renders.
 *
 *   npm run build:mascot
 *
 * The SVGs in design/artwork are the source of truth; src/components/squish-art.ts
 * is generated from them and committed, so the app never reads from design/ at
 * runtime and the artwork never ships to anyone's phone.
 *
 * Four things happen on the way through:
 *
 * 1. **Skin becomes themeable.** The light and dark deliveries differ only in
 *    three skin tones, so those are swapped for custom properties with the light
 *    value as the fallback. One file then serves both themes, and the share card
 *    can pin it light by setting the properties on a clone.
 *
 * 2. **Every id is made instance-unique.** Two mascots on one page — which
 *    happens on Insights the moment the share sheet opens — would otherwise
 *    share `url(#skin)` and the second one would take the first one's gradients.
 *
 * 3. **Animation handles are added.** CSS transforms replace an SVG `transform`
 *    attribute outright rather than composing with it, so the eyes get a wrapper
 *    group to blink on instead of animating the group that is already scaled.
 *
 * 4. **Assumptions are asserted.** If a future artwork drop changes the layer
 *    names, this fails loudly here rather than quietly rendering a mascot with
 *    no eyes.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MOODS = ['excited', 'nomnom', 'calm', 'sleepy', 'proud', 'cheering', 'thinking'] as const;

/** The only colours that differ between the light and dark deliveries. */
const SKIN = [
  { light: '#FFFAF4', variable: '--squish-skin-0' },
  { light: '#FDEADC', variable: '--squish-skin-1' },
  { light: '#F6D7C4', variable: '--squish-skin-2' },
];

/** The wordmark's ink, likewise: dark letters would vanish on a dark screen. */
const INK = [
  { light: '#302637', variable: '--squish-word-0' },
  { light: '#2D2437', variable: '--squish-word-1' },
  { light: '#8C778D', variable: '--squish-word-sheen' },
];

const SOURCE = (mood: string) => `design/artwork/svg/moods/squish-${mood}.svg`;
const WORDMARK = 'design/artwork/svg/squish-wordmark.svg';
const OUTPUT = 'src/components/squish-art.ts';

function inner(svg: string, mood: string): string {
  const open = svg.indexOf('>', svg.indexOf('<svg'));
  const close = svg.lastIndexOf('</svg>');
  if (open < 0 || close < 0) throw new Error(`${mood}: not an SVG document`);
  return svg.slice(open + 1, close).replace(/<title\b[^>]*>.*?<\/title>/gs, '');
}

/** Skin tones become custom properties; everything else is fixed in both themes. */
function themeable(markup: string): string {
  return SKIN.reduce(
    (acc, { light, variable }) =>
      acc.replaceAll(light, `var(${variable}, ${light})`).replaceAll(light.toLowerCase(), `var(${variable}, ${light})`),
    markup,
  );
}

/** `id="skin"` becomes `id="__ID__skin"`, and so does every reference to it. */
function namespaced(markup: string): string {
  return markup
    .replace(/\bid="([^"]+)"/g, 'id="__ID__$1"')
    .replace(/url\(#([^)]+)\)/g, 'url(#__ID__$1)')
    .replace(/\b(aria-labelledby|href|xlink:href)="#([^"]+)"/g, '$1="#__ID__$2"');
}

/**
 * Give the CSS something to animate. The eyes are wrapped rather than
 * classed: they carry `transform="scale(4)"`, and a CSS transform would
 * throw that away and drop the face to a sixteenth of its size.
 */
function animatable(markup: string, mood: string): string {
  const eyes = markup.match(/<g id="__ID__eyes"[^>]*>.*?<\/g>(?=<g id="__ID__mouth")/s);
  if (!eyes) throw new Error(`${mood}: no eyes group to blink`);

  return markup
    .replace(eyes[0], `<g class="sq-blink">${eyes[0]}</g>`)
    .replace(/<g id="__ID__accents"\s*>/, '<g id="__ID__accents" class="sq-accents">')
    .replace(/<g id="__ID__props"\s*>/, '<g id="__ID__props" class="sq-props">');
}

const art = MOODS.map((mood) => {
  const raw = readFileSync(SOURCE(mood), 'utf8');

  if (!raw.includes(`data-mood="${mood}"`)) throw new Error(`${mood}: the face is not labelled with its mood`);
  if (raw.includes('<image') || raw.includes('base64')) throw new Error(`${mood}: contains a raster image, not vector art`);

  const markup = animatable(namespaced(themeable(inner(raw, mood))), mood);

  for (const { light } of SKIN) {
    // Only inside a var() fallback, never as a bare fill.
    if (new RegExp(`(?<!, )${light}`, 'i').test(markup)) throw new Error(`${mood}: a skin tone escaped theming`);
  }
  return [mood, markup] as const;
});

const wordmarkRaw = readFileSync(WORDMARK, 'utf8');
const wordmarkBox = wordmarkRaw.match(/viewBox="([^"]+)"/)?.[1];
if (!wordmarkBox) throw new Error('wordmark: no viewBox');

const wordmark = namespaced(
  INK.reduce((acc, { light, variable }) => acc.replaceAll(light, `var(${variable}, ${light})`), inner(wordmarkRaw, 'wordmark')),
);
for (const { light } of INK) {
  if (new RegExp(`(?<!, )${light}`, 'i').test(wordmark)) throw new Error('wordmark: an ink colour escaped theming');
}

const file = `/**
 * The Squish mascot, generated from design/artwork by scripts/build-mascot.ts.
 * Do not edit by hand — change the artwork and run \`npm run build:mascot\`.
 *
 * Each entry is the inner markup of one pose. \`__ID__\` is replaced with a
 * per-instance prefix at render time so two mascots on a page keep their own
 * gradients.
 */
import type { Mood } from '../types';

export const MASCOT_VIEWBOX = '0 0 512 512';

export const MASCOT_ART: Record<Mood, string> = {
${art.map(([mood, markup]) => `  ${mood}: ${JSON.stringify(markup)},`).join('\n')}
};

/** The traced lettering, with its ink themeable the way the skin is. */
export const WORDMARK_VIEWBOX = ${JSON.stringify(wordmarkBox)};
export const WORDMARK_ART = ${JSON.stringify(wordmark)};
`;

writeFileSync(OUTPUT, file);

const sizes = [...art, ['wordmark', wordmark] as const]
  .map(([name, markup]) => `${name} ${(markup.length / 1024).toFixed(1)}k`)
  .join('  ');
console.log(`Wrote ${OUTPUT}\n  ${sizes}\n  ${(file.length / 1024).toFixed(1)}k total`);
