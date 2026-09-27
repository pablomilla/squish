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
 * Beside it, the UK's own table: McCance and Widdowson's "Composition of
 * Foods Integrated Dataset" (CoFID), about 2,900 foods as the British eat
 * them — semi-skimmed milk, crumpets, fortified flour — published by the
 * government under the Open Government Licence. It is an Excel file, found
 * on its gov.uk page and read by server/xlsx.ts. People in Britain, Ireland,
 * Australia and New Zealand are matched against it first; the US and Canada
 * against USDA first (server/grounding.ts).
 *
 *   SQUISH_FOOD_TABLE_COFID_URL   the .xlsx itself, to skip finding it
 *   SQUISH_FOOD_TABLE_COFID_PAGE  the gov.uk page it is found on
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
import { readWorkbook, type Sheet } from './xlsx';

export const USDA_URL =
  process.env.SQUISH_FOOD_TABLE_USDA_URL ?? 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';

export const COFID_PAGE =
  process.env.SQUISH_FOOD_TABLE_COFID_PAGE ?? 'https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid';

export type TableSource = 'usda' | 'cofid';

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
  source: TableSource;
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
const LEAVE_OUT = /^(babyfood|baby food|infant formula|child formula|follow-on formula)/i;

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

/**
 * CoFID's columns, found by what their headers say rather than where they
 * sit: the nutrients are spread over several sheets (proximates, inorganics,
 * vitamins, fatty acids), and the order has changed between releases. The
 * unit is checked too, so a column in the wrong unit is never read as ours —
 * and saturates must be per 100 g of food, not per 100 g of fatty acids,
 * which the same workbook also gives.
 */
const COFID_COLUMNS: { key: keyof Per100; header: RegExp; unit: RegExp }[] = [
  { key: 'calories', header: /^energy\b.*kcal/i, unit: /kcal/i },
  { key: 'protein', header: /^protein\b/i, unit: /\(g\)/i },
  { key: 'fat', header: /^fat\b/i, unit: /\(g\)/i },
  { key: 'carbs', header: /^carbohydrate\b/i, unit: /\(g\)/i },
  { key: 'sugar', header: /^total sugars\b/i, unit: /\(g\)/i },
  { key: 'fibre', header: /^aoac fibre\b/i, unit: /\(g\)/i },
  { key: 'satFat', header: /^(satd|saturated)\s*(fa|fatty acids)\b.*100\s*g\s*(fd|food)\b/i, unit: /\(g\)/i },
  { key: 'sodium', header: /^sodium\b/i, unit: /\bmg\b/i },
  { key: 'iron', header: /^iron\b/i, unit: /\bmg\b/i },
  { key: 'calcium', header: /^calcium\b/i, unit: /\bmg\b/i },
  { key: 'vitaminD', header: /^vitamin d\s*\(/i, unit: /(µg|μg|ug|mcg)/i },
  { key: 'vitaminB12', header: /^vitamin b12\b/i, unit: /(µg|μg|ug|mcg)/i },
  { key: 'folate', header: /^folate\b/i, unit: /(µg|μg|ug|mcg)/i },
  { key: 'vitaminC', header: /^vitamin c\b/i, unit: /\bmg\b/i },
];

/** A CoFID cell: "Tr" is a trace (nought), "N" is not measured (nothing), brackets mark an estimate. */
export function cofidNumber(text: string | undefined): number | undefined {
  const value = (text ?? '').trim();
  if (!value || /^n$/i.test(value)) return undefined;
  if (/^tr$/i.test(value)) return 0;
  const number = Number.parseFloat(value.replace(/[()]/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

const clean = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/** CoFID's sheets, joined by food code into foods per 100 g. */
export function cofidFoods(sheets: Sheet[]): TableFood[] {
  const names = new Map<string, string>();
  const values = new Map<string, Per100>();
  const found = new Set<keyof Per100>();

  for (const sheet of sheets) {
    const headerAt = sheet.rows.slice(0, 10).findIndex((row) => row.some((cell) => /^food\s*code$/i.test(clean(cell))));
    if (headerAt < 0) continue;
    const header = sheet.rows[headerAt].map(clean);
    const codeColumn = header.findIndex((cell) => /^food\s*code$/i.test(cell));
    const nameColumn = header.findIndex((cell) => /^food\s*name$/i.test(cell));
    const columns = COFID_COLUMNS.flatMap((wanted) => {
      if (found.has(wanted.key)) return []; // the first sheet to have it is the one used
      const at = header.findIndex((cell) => wanted.header.test(cell) && wanted.unit.test(cell));
      return at < 0 ? [] : [{ key: wanted.key, at }];
    });
    for (const { key } of columns) found.add(key);

    for (const row of sheet.rows.slice(headerAt + 1)) {
      const code = clean(row?.[codeColumn]);
      if (!code || !/\d/.test(code)) continue; // the unit and code rows under the header
      const name = nameColumn >= 0 ? clean(row[nameColumn]) : '';
      if (name && !names.has(code)) names.set(code, name);
      const per100 = values.get(code) ?? {};
      for (const { key, at } of columns) {
        const value = cofidNumber(row[at]);
        if (value !== undefined) per100[key] = value;
      }
      values.set(code, per100);
    }
  }

  return [...values.entries()]
    .filter(([code, per100]) => names.has(code) && typeof per100.calories === 'number' && !LEAVE_OUT.test(names.get(code)!))
    .map(([code, per100]) => ({ source: 'cofid' as const, id: code, name: names.get(code)!, per100 }));
}

/**
 * Where CoFID's workbook is: the gov.uk page links it, under an address with
 * a hash in it that changes with each release, so it is looked up each time.
 */
export async function findCofidUrl(page = COFID_PAGE): Promise<string> {
  if (process.env.SQUISH_FOOD_TABLE_COFID_URL) return process.env.SQUISH_FOOD_TABLE_COFID_URL;
  const response = await fetch(page, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`CoFID page: HTTP ${response.status}`);
  const html = await response.text();
  const links = [...html.matchAll(/href="([^"]+\.xlsx)"/gi)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), page).href);
  // The page also links a user guide and older releases: the dataset itself says so in its name.
  const named = (pattern: RegExp) => links.find((link) => pattern.test(decodeURIComponent(link)) && !/guide|user|documentation/i.test(decodeURIComponent(link)));
  const best = named(/integrated[_ -]?dataset/i) ?? named(/cofid/i);
  if (!best) throw new Error(`no CoFID dataset linked from ${page} (found ${links.length} spreadsheet${links.length === 1 ? '' : 's'})`);
  return best;
}

/** Arbitrary, agreed only with ourselves: "somebody is loading the food table". */
const IMPORT_LOCK = 8_273_462;

/**
 * Put a table's foods in the database, replacing that source's old ones, in
 * one transaction under a lock — two instances starting together load it
 * once, and a failure half-way leaves the old table as it was.
 */
export async function saveFoods(source: TableSource, foods: TableFood[], url: string): Promise<boolean> {
  await migrate();
  const saved = await transaction(async (client) => {
    const locked = (await client.query<{ ok: boolean }>('select pg_try_advisory_xact_lock($1) as ok', [IMPORT_LOCK])).rows[0]?.ok;
    if (!locked) return false;
    await client.query('delete from food_table where source = $1', [source]);
    for (let i = 0; i < foods.length; i += 1000) {
      const batch = foods.slice(i, i + 1000);
      await client.query(
        `insert into food_table (source, id, name, per100)
         select $4, id, name, per100 from unnest($1::text[], $2::text[], $3::jsonb[]) as t(id, name, per100)`,
        [batch.map((f) => f.id), batch.map((f) => f.name), batch.map((f) => JSON.stringify(f.per100)), source],
      );
    }
    await client.query(
      `insert into food_table_imports (source, foods, url) values ($3, $1, $2)
       on conflict (source) do update set foods = excluded.foods, url = excluded.url, imported_at = now()`,
      [foods.length, url, source],
    );
    return true;
  });
  if (saved) loaded = null; // the next lookup reads the new table
  return saved;
}

/** Download a file to a temporary folder and hand its path to `use`; the folder goes afterwards. */
async function withDownload<T>(url: string, name: string, use: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'squish-foods-'));
  try {
    const path = join(dir, name);
    const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(path));
    return await use(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Download USDA's table and load it. Returns how many foods, or 0 when another instance is doing it. */
export async function importUsda(url = USDA_URL, minimum = 1000): Promise<number> {
  return withDownload(url, 'usda.zip', async (path) => {
    const foods = await readUsdaZip(path);
    // A truncated or changed download reads as a handful of foods: better no table than a thin one.
    if (foods.length < minimum) throw new Error(`only ${foods.length} foods in the download — not loading a table that small`);
    return (await saveFoods('usda', foods, url)) ? foods.length : 0;
  });
}

/** Find CoFID's workbook, download it and load it. Returns how many foods, or 0 when another instance is doing it. */
export async function importCofid(url?: string, minimum = 1000): Promise<number> {
  const address = url ?? (await findCofidUrl());
  return withDownload(address, 'cofid.xlsx', async (path) => {
    const foods = cofidFoods(await readWorkbook(path));
    if (foods.length < minimum) throw new Error(`only ${foods.length} foods read from CoFID — not loading a table that small`);
    return (await saveFoods('cofid', foods, address)) ? foods.length : 0;
  });
}

/**
 * At start-up: load the table if there is none yet. In the background, and
 * never fatal — without a table every meal is read exactly as before.
 */
export async function ensureFoodTable(): Promise<void> {
  if (!foodTableOn()) return;
  await migrate();
  const done = new Set((await query<{ source: string }>('select source from food_table_imports')).map((row) => row.source));
  const sources: [TableSource, string, () => Promise<number>][] = [
    ['usda', 'USDA FoodData Central', () => importUsda()],
    ['cofid', "McCance and Widdowson's CoFID", () => importCofid()],
  ];
  // One at a time, each on its own: one source failing leaves the other loaded.
  for (const [source, label, load] of sources) {
    if (done.has(source)) continue;
    const started = Date.now();
    try {
      console.log(`[squish] food table: downloading ${label} (once)…`);
      const count = await load();
      if (count) console.log(`[squish] food table: ${count} ${source} foods loaded in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (error) {
      console.warn(`[squish] food table: ${label} not loaded —`, error instanceof Error ? error.message : error);
    }
  }
}

let loaded: Promise<TableFood[]> | null = null;

/** Every food in the table, read once per process (and again after an import). Empty without one. */
export function tableFoods(): Promise<TableFood[]> {
  if (!foodTableOn()) return Promise.resolve([]);
  loaded ??= (async () => {
    await migrate();
    const rows = await query<{ source: TableSource; id: string; name: string; per100: Per100 }>('select source, id, name, per100 from food_table');
    // Nothing yet (still importing): ask again next time rather than remember "none".
    if (!rows.length) loaded = null;
    return rows;
  })().catch((error: unknown) => {
    loaded = null;
    throw error;
  });
  return loaded;
}
