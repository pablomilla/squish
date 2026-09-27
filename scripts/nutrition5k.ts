/**
 * A benchmark set from Nutrition5k, Google Research's dataset of weighed
 * cafeteria dishes (Thames et al., "Nutrition5k: Towards Automatic
 * Nutritional Understanding of Generic Food", CVPR 2021).
 *
 *   npm run nutrition5k                   100 dishes from the official test split
 *   npm run nutrition5k -- --count 507    all of them
 *   npm run nutrition5k -- --seed 2       a different 100
 *
 * Then: npm run bench -- --set nutrition5k
 *
 * Each dish was photographed from overhead on a scanning rig and every
 * ingredient weighed as it was added, so the truth is a scale, not a guess:
 * total mass, calories, fat, carbohydrate and protein. That makes it the one
 * outside yardstick Squish can be held to, and the paper's own models give a
 * bar to clear — 26.1% calorie error from a photo alone, 18.8% with depth.
 *
 * Only dishes from the official test split with an overhead photo (the
 * "depth" test split, 507 dishes), because those are the ones the paper's
 * overhead results were measured on. The data is released under CC BY 4.0;
 * it is downloaded to bench/nutrition5k/, which git ignores, not copied into
 * the repository.
 *
 * Caveats worth keeping in mind when reading the results: the dishes are from
 * Google's cafeterias in California, photographed straight down on a rig
 * rather than on a phone, and some are part-built plates (one ingredient,
 * then two…) from its incremental scans. It measures reading a plate; it
 * does not measure British home cooking.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MealFixture } from './bench';

const BUCKET = 'https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset';
const OUT = resolve(process.cwd(), 'bench', 'nutrition5k');
export const CITATION = 'Nutrition5k (Thames et al., CVPR 2021), CC BY 4.0';

export interface Dish {
  id: string;
  calories: number;
  grams: number;
  fat: number;
  carbs: number;
  protein: number;
  ingredients: string[];
}

/**
 * The dish metadata CSV: dish_id, total_calories, total_mass, total_fat,
 * total_carb, total_protein, then seven fields per ingredient (id, name,
 * grams, calories, fat, carb, protein). A line that does not parse is left
 * out rather than guessed at.
 */
export function parseDishes(csv: string): Map<string, Dish> {
  const dishes = new Map<string, Dish>();
  for (const line of csv.split(/\r?\n/)) {
    const cells = line.split(',');
    if (!cells[0]?.startsWith('dish_') || cells.length < 6) continue;
    const [calories, grams, fat, carbs, protein] = cells.slice(1, 6).map(Number);
    if (![calories, grams, fat, carbs, protein].every(Number.isFinite)) continue;
    const ingredients: string[] = [];
    for (let i = 6; i + 6 < cells.length; i += 7) if (cells[i + 1]) ingredients.push(cells[i + 1].trim());
    dishes.set(cells[0], { id: cells[0], calories, grams, fat, carbs, protein, ingredients });
  }
  return dishes;
}

/** The same "random" pick every time for a seed, so two runs compare the same dishes. */
export function sample<T>(items: T[], count: number, seed: number): T[] {
  let state = seed >>> 0 || 1;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

/** A dish as a benchmark meal: its id is its name, so every result can be traced back to the dataset. */
export function toFixture(dish: Dish): MealFixture {
  // As the dataset has them, unrounded, so a score matches Google's own script to the last digit.
  return {
    file: `${dish.id}.png`,
    name: dish.id,
    calories: dish.calories,
    protein: dish.protein,
    carbs: dish.carbs,
    fat: dish.fat,
    grams: dish.grams,
    source: `${CITATION}, weighed: ${dish.ingredients.slice(0, 6).join(', ')}${dish.ingredients.length > 6 ? '…' : ''}`,
  };
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(`${BUCKET}/${path}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Nutrition5k ${path}: ${response.status}`);
  return response.text();
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const count = Math.max(1, Math.min(507, Number(arg('count') ?? 100)));
  const seed = Number(arg('seed') ?? 1);
  console.log(`\n🫧  Nutrition5k · ${count} dishes from the official overhead test split (seed ${seed})\n`);

  const [ids, cafe1, cafe2] = await Promise.all([
    fetchText('dish_ids/splits/depth_test_ids.txt'),
    fetchText('metadata/dish_metadata_cafe1.csv'),
    fetchText('metadata/dish_metadata_cafe2.csv'),
  ]);
  const dishes = new Map([...parseDishes(cafe1), ...parseDishes(cafe2)]);
  const testIds = ids.split(/\s+/).filter((id) => dishes.has(id));
  const chosen = sample(testIds, count, seed).map((id) => dishes.get(id)!);
  console.log(`  ${testIds.length} test dishes with weighed figures; taking ${chosen.length}.`);

  await mkdir(resolve(OUT, 'photos'), { recursive: true });
  let fetched = 0;
  const missing: string[] = [];
  // A few at a time: polite to the bucket, and quick enough.
  for (let i = 0; i < chosen.length; i += 6) {
    await Promise.all(
      chosen.slice(i, i + 6).map(async (dish) => {
        const path = resolve(OUT, 'photos', `${dish.id}.png`);
        if (await exists(path)) return;
        const response = await fetch(`${BUCKET}/imagery/realsense_overhead/${dish.id}/rgb.png`, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) {
          missing.push(dish.id);
          return;
        }
        await writeFile(path, Buffer.from(await response.arrayBuffer()));
        fetched += 1;
      }),
    );
    process.stdout.write(`\r  Photos: ${Math.min(i + 6, chosen.length)}/${chosen.length}`);
  }
  console.log(`\n  Downloaded ${fetched} new photo${fetched === 1 ? '' : 's'}.`);

  const fixtures = chosen.filter((dish) => !missing.includes(dish.id)).map(toFixture);
  if (missing.length) console.log(`  No overhead photo for ${missing.length} (${missing.join(', ')}); left out.`);
  await writeFile(resolve(OUT, 'manifest.json'), JSON.stringify(fixtures, null, 2));
  console.log(`  Written bench/nutrition5k/manifest.json — ${fixtures.length} dishes.\n`);
  console.log('  Next: npm run bench -- --set nutrition5k   (it asks before spending anything)\n');
}

const runDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (runDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
