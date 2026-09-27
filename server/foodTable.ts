/**
 * A food composition table: what 100 g of a plain food contains, measured by
 * a government laboratory rather than remembered by a language model.
 *
 * The AI is good at seeing what is on a plate and how much of it there is.
 * It is less good at knowing that 100 g of boiled rice is 130 kcal and not
 * 150 — and it does not know it the same way twice. So for a plain food the
 * AI names in food-table words ("rice, white, cooked"), the nutrition per
 * gram comes from here, and the AI's own figures stay for everything a table
 * cannot answer: a curry, a takeaway, a branded bar. See server/foodMatch.ts
 * for the matching, which is deliberately cautious.
 *
 * The source is the USDA's FoodData Central, "SR Legacy": about 7,800
 * foods, public domain. The server downloads it the first time it starts
 * without a table (about 7 MB, a minute's work, once) and keeps what Squish
 * uses in Postgres, so every instance and every restart shares it.
 *
 *   SQUISH_FOOD_TABLE=off        never download, never match
 *   SQUISH_FOOD_TABLE_USDA_URL   where to fetch it, if USDA moves the file
 *
 * A UK table (McCance and Widdowson's CoFID) would be the better source for
 * British foods; it is an Excel file this server cannot yet read, and the
 * `source` column is there for when it can.
 */
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { hasDatabase, migrate, query, transaction } from './db';

export const USDA_URL =
  process.env.SQUISH_FOOD_TABLE_USDA_URL ?? 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';

export const foodTableOn = (): boolean => hasDatabase() && process.env.SQUISH_FOOD_TABLE !== 'off';

/** Per 100 g: the nutrients Squish tracks, where the table has them. */
export type Per100 = Partial<{
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  sugar: number;
  satFat: number;
  sodium: number;
  iron: number;
  calcium: number;
  vitaminD: number;
  vitaminB12: number;
  folate: number;
  vitaminC: number;
}>;

export interface TableFood {
  source: 'usda';
  id: string;
  name: string;
  per100: Per100;
}

/**
 * USDA nutrient numbers ("nutrient_nbr", stable since the old SR releases)
 * and the FoodData Central ids beside them, for the file that has only one.
 * Units are the ones Squish uses: kcal, g, mg, µg.
 */
const USDA_NUTRIENTS: { key: keyof Per100; nbr: number; id: number }[] = [
  { key: 'calories', nbr: 208, id: 1008 },
  { key: 'protein', nbr: 203, id: 1003 },
  { key: 'fat', nbr: 204, id: 1004 },
  { key: 'carbs', nbr: 205, id: 1005 },
  { key: 'fibre', nbr: 291, id: 1079 },
  { key: 'sugar', nbr: 269, id: 2000 },
  { key: 'satFat', nbr: 606, id: 1258 },
  { key: 'sodium', nbr: 307, id: 1093 },
  { key: 'iron', nbr: 303, id: 1089 },
  { key: 'calcium', nbr: 301, id: 1087 },
  { key: 'vitaminD', nbr: 328, id: 1114 },
  { key: 'vitaminB12', nbr: 418, id: 1178 },
  { key: 'folate', nbr: 417, id: 1177 },
  { key: 'vitaminC', nbr: 401, id: 1162 },
];

/** Foods that are not what anybody photographs for themselves, and would only muddle a match. */
const LEAVE_OUT = /^(babyfood|infant formula|child formula)/i;

/** One CSV line into fields: quoted fields, doubled quotes inside them, commas between. */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

/** Every row of one CSV in the zip, as a record keyed by its header. */
async function* rowsOf(zip: ZipFile, entry: Entry): AsyncGenerator<Record<string, string>> {
  const stream = await new Promise<Readable>((resolve, reject) =>
    zip.openReadStream(entry, (error, opened) => (error || !opened ? reject(error ?? new Error('unreadable entry')) : resolve(opened))),
  );
  let header: string[] | null = null;
  for await (const raw of createInterface({ input: stream, crlfDelay: Infinity })) {
    const line = raw.replace(/^﻿/, '');
    if (!line.trim()) continue;
    const fields = csvFields(line);
    if (!header) {
      header = fields.map((f) => f.trim().toLowerCase());
      continue;
    }
    yield Object.fromEntries(header.map((name, i) => [name, fields[i] ?? '']));
  }
}

/** The three files that matter, however the zip names its folder. */
async function entriesOf(path: string): Promise<{ zip: ZipFile; food: Entry; nutrient: Entry; foodNutrient: Entry }> {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, opened) => (error || !opened ? reject(error ?? new Error('unreadable zip')) : resolve(opened))),
  );
  const found = new Map<string, Entry>();
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: Entry) => {
      const name = entry.fileName.split('/').pop() ?? '';
      if (['food.csv', 'nutrient.csv', 'food_nutrient.csv'].includes(name)) found.set(name, entry);
      zip.readEntry();
    });
    zip.on('end', () => resolve());
    zip.on('error', reject);
    zip.readEntry();
  });
  const food = found.get('food.csv');
  const nutrient = found.get('nutrient.csv');
  const foodNutrient = found.get('food_nutrient.csv');
  if (!food || !nutrient || !foodNutrient) {
    zip.close();
    throw new Error(`not a FoodData Central CSV download (found ${[...found.keys()].join(', ') || 'none of its files'})`);
  }
  return { zip, food, nutrient, foodNutrient };
}

/** Read a downloaded FoodData Central CSV zip into foods, per 100 g. */
export async function readUsdaZip(path: string): Promise<TableFood[]> {
  const { zip, food, nutrient, foodNutrient } = await entriesOf(path);
  try {
    // Which nutrient ids in this file are ours: by number where it has one, by id otherwise.
    const ours = new Map<string, keyof Per100>();
    for await (const row of rowsOf(zip, nutrient)) {
      const nbr = Number.parseFloat(row.nutrient_nbr);
      const byNumber = USDA_NUTRIENTS.find((n) => n.nbr === nbr);
      const byId = USDA_NUTRIENTS.find((n) => String(n.id) === row.id);
      const match = byNumber ?? byId;
      if (match && row.id) ours.set(row.id, match.key);
    }
    if (!ours.size) throw new Error('nutrient.csv lists none of the nutrients Squish uses');

    const names = new Map<string, string>();
    for await (const row of rowsOf(zip, food)) {
      const name = row.description?.trim();
      if (row.fdc_id && name && !LEAVE_OUT.test(name)) names.set(row.fdc_id, name);
    }

    const per100 = new Map<string, Per100>();
    for await (const row of rowsOf(zip, foodNutrient)) {
      const key = ours.get(row.nutrient_id);
      if (!key || !names.has(row.fdc_id)) continue;
      const amount = Number.parseFloat(row.amount);
      if (!Number.isFinite(amount) || amount < 0) continue;
      const values = per100.get(row.fdc_id) ?? {};
      values[key] = amount;
      per100.set(row.fdc_id, values);
    }

    // Only foods with an energy figure: without one there is nothing to check a match against.
    return [...per100.entries()]
      .filter(([, values]) => typeof values.calories === 'number')
      .map(([id, values]) => ({ source: 'usda' as const, id, name: names.get(id)!, per100: values }));
  } finally {
    zip.close();
  }
}

/** Arbitrary, agreed only with ourselves: "somebody is loading the food table". */
const IMPORT_LOCK = 8_273_462;

/**
 * Put a table's foods in the database, replacing that source's old ones, in
 * one transaction under a lock — two instances starting together load it
 * once, and a failure half-way leaves the old table as it was.
 */
export async function saveFoods(foods: TableFood[], url: string): Promise<boolean> {
  await migrate();
  const saved = await transaction(async (client) => {
    const locked = (await client.query<{ ok: boolean }>('select pg_try_advisory_xact_lock($1) as ok', [IMPORT_LOCK])).rows[0]?.ok;
    if (!locked) return false;
    await client.query('delete from food_table where source = $1', ['usda']);
    for (let i = 0; i < foods.length; i += 1000) {
      const batch = foods.slice(i, i + 1000);
      await client.query(
        `insert into food_table (source, id, name, per100)
         select 'usda', id, name, per100 from unnest($1::text[], $2::text[], $3::jsonb[]) as t(id, name, per100)`,
        [batch.map((f) => f.id), batch.map((f) => f.name), batch.map((f) => JSON.stringify(f.per100))],
      );
    }
    await client.query(
      `insert into food_table_imports (source, foods, url) values ('usda', $1, $2)
       on conflict (source) do update set foods = excluded.foods, url = excluded.url, imported_at = now()`,
      [foods.length, url],
    );
    return true;
  });
  if (saved) loaded = null; // the next lookup reads the new table
  return saved;
}

/** Download USDA's table and load it. Returns how many foods, or 0 when another instance is doing it. */
export async function importUsda(url = USDA_URL, minimum = 1000): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'squish-foods-'));
  try {
    const path = join(dir, 'usda.zip');
    const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(path));
    const foods = await readUsdaZip(path);
    // A truncated or changed download reads as a handful of foods: better no table than a thin one.
    if (foods.length < minimum) throw new Error(`only ${foods.length} foods in the download — not loading a table that small`);
    return (await saveFoods(foods, url)) ? foods.length : 0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * At start-up: load the table if there is none yet. In the background, and
 * never fatal — without a table every meal is read exactly as before.
 */
export async function ensureFoodTable(): Promise<void> {
  if (!foodTableOn()) return;
  await migrate();
  const done = await query('select 1 from food_table_imports where source = $1', ['usda']);
  if (done.length) return;
  console.log('[squish] food table: downloading USDA FoodData Central (once)…');
  const started = Date.now();
  const count = await importUsda();
  if (count) console.log(`[squish] food table: ${count} foods loaded in ${Math.round((Date.now() - started) / 1000)}s`);
}

let loaded: Promise<TableFood[]> | null = null;

/** Every food in the table, read once per process (and again after an import). Empty without one. */
export function tableFoods(): Promise<TableFood[]> {
  if (!foodTableOn()) return Promise.resolve([]);
  loaded ??= (async () => {
    await migrate();
    const rows = await query<{ source: 'usda'; id: string; name: string; per100: Per100 }>('select source, id, name, per100 from food_table');
    // Nothing yet (still importing): ask again next time rather than remember "none".
    if (!rows.length) loaded = null;
    return rows;
  })().catch((error: unknown) => {
    loaded = null;
    throw error;
  });
  return loaded;
}
