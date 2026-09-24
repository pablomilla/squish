/**
 * Turn the delivered accessory artwork into the markup the app renders.
 *
 *   npm run build:accessories
 *
 * The designer's delivery in design/extras is the source of truth; the files
 * in src/components/accessory-art/ are generated from it and committed, the
 * same way the mascot is. The app never reads design/ at runtime.
 *
 * Every accessory arrives already fitted to each of the seven poses, as a
 * `back` layer (drawn behind Squish's body) and a `front` layer, both in the
 * poses' own 512 × 512 space. So nothing is measured or moved here. What does
 * happen:
 *
 * 1. **Ids are namespaced** by item and by instance. Every hat calls its
 *    gradient `cloth`, and two of them on one page — or a hat and a scarf on
 *    one Squish — would otherwise paint with each other's colours.
 *
 * 2. **Numbers are rounded** to two places. The delivery carries fifteen
 *    significant figures, which nobody can see and everybody downloads.
 *
 * 3. **Assumptions are asserted.** A missing pose, a raster image, live text
 *    or a stylesheet fails the build here rather than showing up as a bald
 *    Squish in one mood.
 *
 * Winter arrives twice (once in phase 2, again with the other seasonal kits)
 * and the two copies are identical, so the first one found wins.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MOODS = ['excited', 'nomnom', 'calm', 'sleepy', 'proud', 'cheering', 'thinking'] as const;
const ROOT = 'design/extras';
const OUTPUT = 'src/components/accessory-art';

interface Item {
  id: string;
  slot: 'head' | 'face' | 'neck';
}

/** Every folder holding an item.json, wherever in the delivery it sits. */
function findItems(dir: string, found: Map<string, string> = new Map()): Map<string, string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    if (existsSync(join(path, 'item.json'))) {
      const { id } = JSON.parse(readFileSync(join(path, 'item.json'), 'utf8')) as Item;
      if (!found.has(id)) found.set(id, path);
    } else {
      findItems(path, found);
    }
  }
  return found;
}

const round = (markup: string) =>
  markup.replace(/-?\d+\.\d{3,}/g, (n) => String(Math.round(Number(n) * 100) / 100));

/** The layer's defs and drawing, without the wrapper document. */
function layer(svg: string, which: 'back' | 'front', item: string, mood: string): string {
  const where = `${item} ${mood}-${which}`;
  if (/<image\b|base64|<text\b|<style\b|\bclass=|<filter\b|<mask\b/.test(svg)) {
    throw new Error(`${where}: contains something the app cannot use (raster, text, CSS, filter or mask)`);
  }
  const defs = svg.match(/<defs>([\s\S]*?)<\/defs>/)?.[1] ?? '';
  const open = svg.match(new RegExp(`<g id="${which}"[^>]*>`));
  if (!open) throw new Error(`${where}: no <g id="${which}"> layer`);
  const start = svg.indexOf(open[0]) + open[0].length;
  const end = svg.lastIndexOf('</g>');
  const drawing = svg.slice(start, end);

  // A back layer with nothing in it is normal — a crown has no back — and is
  // left out entirely rather than shipped as an empty transformed group.
  if (!/<(path|ellipse|circle|rect|polygon|polyline|line)\b/.test(drawing)) return '';

  const prefix = `__ID__${item}-`;
  return round(
    (defs ? `<defs>${defs}</defs>` : '') + drawing,
  )
    .replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`)
    .replace(/\s+data-[a-z-]+="[^"]*"/g, '');
}

const items = findItems(ROOT);
if (items.size === 0) throw new Error(`No accessories found under ${ROOT}`);

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });

const summary: string[] = [];
let total = 0;
for (const [id, dir] of items) {
  const item = JSON.parse(readFileSync(join(dir, 'item.json'), 'utf8')) as Item;
  if (!['head', 'face', 'neck'].includes(item.slot)) throw new Error(`${id}: unknown slot ${item.slot}`);

  const art: Record<'back' | 'front', Record<string, string>> = { back: {}, front: {} };
  for (const mood of MOODS) {
    for (const which of ['back', 'front'] as const) {
      const file = join(dir, 'fitted', `${mood}-${which}.svg`);
      if (!existsSync(file)) throw new Error(`${id}: no ${mood}-${which}.svg`);
      art[which][mood] = layer(readFileSync(file, 'utf8'), which, id, mood);
    }
    if (!art.front[mood]) throw new Error(`${id}: the ${mood} front layer is empty`);
  }

  const file = `/**
 * ${id}, generated from ${dir} by scripts/build-accessories.ts.
 * Do not edit by hand — change the artwork and run \`npm run build:accessories\`.
 */
import type { AccessoryArt } from '../../lib/outfit';

const art: AccessoryArt = ${JSON.stringify(art, null, 2)};

export default art;
`;
  writeFileSync(join(OUTPUT, `${id}.ts`), file);
  total += file.length;
  summary.push(`${id} ${(file.length / 1024).toFixed(1)}k`);
}

console.log(`Wrote ${items.size} accessories to ${OUTPUT}\n  ${summary.join('  ')}\n  ${(total / 1024).toFixed(1)}k total`);
