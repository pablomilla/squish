/**
 * The website's artwork, as plain SVG files, from the same source as the app.
 *
 * The mascot and the wordmark live in src/components/squish-art.ts as markup
 * for React to inline. The website has no React, so this writes each one out
 * as a standalone file in site/img/. Run it after the artwork changes:
 *
 *   npm run build:site-art
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MASCOT_ART, MASCOT_VIEWBOX, WORDMARK_ART, WORDMARK_VIEWBOX } from '../src/components/squish-art';

const OUT = resolve(process.cwd(), 'site/img');
mkdirSync(OUT, { recursive: true });

const HEART =
  '<g transform="translate(386 44) scale(4.6)">' +
  '<path d="M12 21.6 3.9 13.3a5.2 5.2 0 0 1 0-7.4 5.2 5.2 0 0 1 7.4 0l.7.7.7-.7a5.2 5.2 0 0 1 7.4 0 5.2 5.2 0 0 1 0 7.4Z" fill="#F4899F"/>' +
  '</g>';

const svg = (viewBox: string, inner: string, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${label}">${inner}</svg>\n`;

for (const [mood, art] of Object.entries(MASCOT_ART)) {
  const inner = art.replaceAll('__ID__', `sq-${mood}-`);
  writeFileSync(resolve(OUT, `squish-${mood}.svg`), svg(MASCOT_VIEWBOX, inner, `Squish looking ${mood}`));
  if (mood === 'excited') {
    writeFileSync(resolve(OUT, 'squish-heart.svg'), svg(MASCOT_VIEWBOX, inner + HEART, 'Squish, with a heart'));
  }
}
const wordmark = WORDMARK_ART.replaceAll('__ID__', 'wm-');
writeFileSync(resolve(OUT, 'wordmark.svg'), svg(WORDMARK_VIEWBOX, wordmark, 'Squish'));
// An <img> cannot see the page's CSS variables, so dark mode gets its own
// file, in the colours the app uses for the wordmark on a dark background.
const dark = wordmark
  .replace(/var\(--squish-word-0, #[0-9a-fA-F]+\)/g, '#f4f0ff')
  .replace(/var\(--squish-word-1, #[0-9a-fA-F]+\)/g, '#e4ddf6')
  .replace(/var\(--squish-word-sheen, #[0-9a-fA-F]+\)/g, 'transparent');
writeFileSync(resolve(OUT, 'wordmark-dark.svg'), svg(WORDMARK_VIEWBOX, dark, 'Squish'));
console.log(`Wrote the mascot and wordmark to ${OUT}`);
