/**
 * Copy the delivered Home scenes into the app.
 *
 *   npm run build:scenes
 *
 * The designer's delivery in design/extras is the source of truth; the files
 * in src/assets/scenes/ are copied from it and committed, the same way the
 * mascot and accessories are, so the app never reads design/ at runtime.
 *
 * A scene is a background image, not markup the app reaches into, so it
 * ships as an SVG file Vite fingerprints and caches like any other asset. On
 * the way through, numbers are rounded, labels are dropped, and anything a
 * background image cannot or should not carry — raster, live text, CSS —
 * fails the build.
 *
 * Winter arrives twice, identically; the first copy found wins.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const ROOT = 'design/extras';
const OUTPUT = 'src/assets/scenes';

/** Every folder under a `scenes` directory that has a light and dark SVG. */
function findScenes(dir: string, found: Map<string, string> = new Map()): Map<string, string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    if (basename(dirname(path)) === 'scenes' && existsSync(join(path, 'light.svg'))) {
      if (!found.has(name)) found.set(name, path);
    } else {
      findScenes(path, found);
    }
  }
  return found;
}

const round = (markup: string) =>
  markup.replace(/-?\d+\.\d{3,}/g, (n) => String(Math.round(Number(n) * 100) / 100));

const scenes = findScenes(ROOT);
if (scenes.size === 0) throw new Error(`No scenes found under ${ROOT}`);

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });

let total = 0;
for (const [id, dir] of scenes) {
  for (const mode of ['light', 'dark']) {
    const file = join(dir, `${mode}.svg`);
    if (!existsSync(file)) throw new Error(`${id}: no ${mode}.svg`);
    const svg = readFileSync(file, 'utf8');
    if (/<image\b|base64|<text\b|<style\b|\bclass=|<script\b|<foreignObject\b/i.test(svg)) {
      throw new Error(`${id} ${mode}: contains raster, text, CSS or script`);
    }
    if (!svg.includes('viewBox="0 0 1344 690"')) throw new Error(`${id} ${mode}: not the 1344 × 690 artboard`);
    const out = round(svg).replace(/\s+role="img"/, '').replace(/\s+aria-label="[^"]*"/, '');
    writeFileSync(join(OUTPUT, `${id}-${mode}.svg`), out);
    total += out.length;
  }
}

console.log(`Wrote ${scenes.size} scenes to ${OUTPUT}: ${[...scenes.keys()].join(', ')}\n  ${(total / 1024).toFixed(1)}k total`);
