/**
 * Copy the delivered share-card frames, stickers and streak badges into the app.
 *
 *   npm run build:share-art
 *
 * The designer's delivery in design/extras is the source of truth; the files
 * in src/assets/share/ are copied from it and committed, like the mascot,
 * accessories and scenes. On the way through, numbers are rounded, labels
 * dropped, and anything a canvas cannot draw or should not be handed —
 * raster, live text, CSS, script — fails the build. Sizes are asserted too:
 * a frame that is not 1080 × 1350 would be stretched over the card.
 *
 * Winter arrives twice, identically; the first copy found wins.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const ROOT = 'design/extras';
const OUTPUT = 'src/assets/share';
const KINDS = { frames: '0 0 1080 1350', stickers: '0 0 240 240', badges: '0 0 240 240' } as const;
type Kind = keyof typeof KINDS;

/** Every SVG sitting in a share/{frames,stickers,badges} folder. */
function findArt(dir: string, found: Record<Kind, Map<string, string>>): void {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    const kind = name as Kind;
    if (basename(dir) === 'share' && kind in KINDS) {
      for (const file of readdirSync(path).sort()) {
        if (!file.endsWith('.svg')) continue;
        const id = file.replace(/\.svg$/, '');
        if (!found[kind].has(id)) found[kind].set(id, join(path, file));
      }
    } else {
      findArt(path, found);
    }
  }
}

const round = (markup: string) =>
  markup.replace(/-?\d+\.\d{3,}/g, (n) => String(Math.round(Number(n) * 100) / 100));

const found: Record<Kind, Map<string, string>> = { frames: new Map(), stickers: new Map(), badges: new Map() };
findArt(ROOT, found);

rmSync(OUTPUT, { recursive: true, force: true });
let total = 0;
const report: string[] = [];
for (const kind of Object.keys(KINDS) as Kind[]) {
  if (found[kind].size === 0) throw new Error(`No ${kind} found under ${ROOT}`);
  mkdirSync(join(OUTPUT, kind), { recursive: true });
  for (const [id, file] of found[kind]) {
    const svg = readFileSync(file, 'utf8');
    if (/<image\b|base64|<text\b|<style\b|\bclass=|<script\b|<foreignObject\b/i.test(svg)) {
      throw new Error(`${kind}/${id}: contains raster, text, CSS or script`);
    }
    if (!svg.includes(`viewBox="${KINDS[kind]}"`)) throw new Error(`${kind}/${id}: expected viewBox ${KINDS[kind]}`);
    const out = round(svg).replace(/\s+role="img"/, '').replace(/\s+aria-label="[^"]*"/, '');
    writeFileSync(join(OUTPUT, kind, `${id}.svg`), out);
    total += out.length;
  }
  report.push(`${found[kind].size} ${kind}: ${[...found[kind].keys()].join(', ')}`);
}

console.log(`Wrote share art to ${OUTPUT}\n  ${report.join('\n  ')}\n  ${(total / 1024).toFixed(1)}k total`);
