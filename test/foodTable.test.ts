import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { csvFields, importUsda, readUsdaZip, tableFoods, type TableFood } from '../server/foodTable';
import { candidates, indexFoods, plausible, words } from '../server/foodMatch';
import { groundMeal, scaled } from '../server/grounding';
import type { ModelMeal } from '../server/claude';

/**
 * The food table: loaded from USDA's download, matched cautiously, and used
 * only where a plain food matches and the numbers agree with what the AI saw.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

/** A zip, stored rather than compressed, which is all a reader needs to see. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// USDA's SR Legacy CSVs, cut down: the same folder, headers, quoting and ids.
const DIR = 'FoodData_Central_sr_legacy_food_csv_2018-04/';
const q = (...fields: (string | number)[]) => fields.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',');
const FOODS: [number, string, number[]][] = [
  // fdc_id, description, [kcal, protein, fat, carbs, fibre, sugar, satFat, sodium, iron, calcium, vitD, B12, folate, vitC]
  [173944, 'Bananas, raw', [89, 1.09, 0.33, 22.84, 2.6, 12.23, 0.112, 1, 0.26, 5, 0, 0, 20, 8.7]],
  [169756, 'Rice, white, long-grain, regular, raw, enriched', [365, 7.13, 0.66, 79.95, 1.3, 0.12, 0.18, 5, 4.31, 28, 0, 0, 231, 0]],
  [168878, 'Rice, white, long-grain, regular, enriched, cooked', [130, 2.69, 0.28, 28.17, 0.4, 0.05, 0.077, 1, 1.2, 10, 0, 0, 58, 0]],
  [169713, 'Rice bran, crude', [316, 13.35, 20.85, 49.69, 21, 0.9, 4.17, 5, 18.54, 57, 0, 0, 63, 0]],
  [173430, 'Cheese, cheddar', [403, 22.87, 33.31, 3.09, 0, 0.48, 18.87, 653, 0.16, 710, 0.6, 1.1, 27, 0]],
  [100001, 'Babyfood, bananas, strained', [65, 1, 0.2, 16, 1.7, 10, 0.1, 2, 0.2, 4, 0, 0, 8, 17]],
  [100002, 'Oil, olive, salad or cooking', [884, 0, 100, 0, 0, 0, 13.81, 2, 0.56, 1, 0, 0, 0, 0]],
];
const NUTRIENTS: [number, string, string, string][] = [
  [1008, 'Energy', 'KCAL', '208.0'], [1003, 'Protein', 'G', '203.0'], [1004, 'Total lipid (fat)', 'G', '204.0'],
  [1005, 'Carbohydrate, by difference', 'G', '205.0'], [1079, 'Fiber, total dietary', 'G', '291.0'],
  [2000, 'Sugars, total including NLEA', 'G', '269.0'], [1258, 'Fatty acids, total saturated', 'G', '606.0'],
  [1093, 'Sodium, Na', 'MG', '307.0'], [1089, 'Iron, Fe', 'MG', '303.0'], [1087, 'Calcium, Ca', 'MG', '301.0'],
  [1114, 'Vitamin D (D2 + D3)', 'UG', '328.0'], [1178, 'Vitamin B-12', 'UG', '418.0'], [1177, 'Folate, total', 'UG', '417.0'],
  [1162, 'Vitamin C, total ascorbic acid', 'MG', '401.0'], [1062, 'Energy', 'kJ', '268.0'],
];
function usdaZip(): Buffer {
  const food = [q('fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date'), ...FOODS.map(([id, name]) => q(id, 'sr_legacy_food', name, 9, '2019-04-01')),
    q(100003, 'sr_legacy_food', 'Water, bottled, generic', 14, '2019-04-01')];
  const nutrient = [q('id', 'name', 'unit_name', 'nutrient_nbr', 'rank'), ...NUTRIENTS.map(([id, name, unit, nbr]) => q(id, name, unit, nbr, 100))];
  let row = 1;
  const foodNutrient = [q('id', 'fdc_id', 'nutrient_id', 'amount', 'data_points', 'derivation_id', 'min', 'max', 'median', 'footnote', 'min_year_acquired')];
  for (const [id, , values] of FOODS) {
    NUTRIENTS.slice(0, 14).forEach(([nutrientId], i) => foodNutrient.push(q(row++, id, nutrientId, values[i], 1, 1, '', '', '', '', '')));
    foodNutrient.push(q(row++, id, 1062, values[0] * 4.184, '', '', '', '', '', '', ''));
  }
  // Water has protein but no energy row: nothing to check a match against, so it is left out.
  foodNutrient.push(q(row++, 100003, 1003, 0, '', '', '', '', '', '', ''));
  return zip({ [`${DIR}food.csv`]: food.join('\r\n'), [`${DIR}nutrient.csv`]: nutrient.join('\r\n'), [`${DIR}food_nutrient.csv`]: foodNutrient.join('\r\n'), [`${DIR}acquisition_samples.csv`]: q('a', 'b') });
}

let files: Server;
let dir: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'squish-foods-test-'));
  await writeFile(join(dir, 'usda.zip'), usdaZip());
  files = createServer(async (_req, res) => res.end(await readFile(join(dir, 'usda.zip'))));
  await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', () => resolve()));
  if (enabled) await migrate();
});
after(async () => {
  files.close();
  await rm(dir, { recursive: true, force: true });
  if (enabled) {
    await query(`delete from food_table where source = 'usda'`);
    await query(`delete from food_table_imports where source = 'usda'`);
    await closeDatabase();
  }
});

test('a CSV line: quotes, doubled quotes, commas inside quotes, empty fields', () => {
  assert.deepEqual(csvFields('"1","Rice, white, cooked","say ""hi""",,"x"'), ['1', 'Rice, white, cooked', 'say "hi"', '', 'x']);
});

test('USDA’s download becomes foods per 100 g — babyfood and foods with no energy figure left out', async () => {
  const foods = await readUsdaZip(join(dir, 'usda.zip'));
  assert.deepEqual(foods.map((f) => f.name).sort(), [
    'Bananas, raw', 'Cheese, cheddar', 'Oil, olive, salad or cooking', 'Rice bran, crude',
    'Rice, white, long-grain, regular, enriched, cooked', 'Rice, white, long-grain, regular, raw, enriched',
  ]);
  const banana = foods.find((f) => f.name === 'Bananas, raw')!;
  assert.deepEqual(banana, {
    source: 'usda', id: '173944', name: 'Bananas, raw',
    per100: { calories: 89, protein: 1.09, fat: 0.33, carbs: 22.84, fibre: 2.6, sugar: 12.23, satFat: 0.112, sodium: 1, iron: 0.26, calcium: 5, vitaminD: 0, vitaminB12: 0, folate: 20, vitaminC: 8.7 },
  }, 'kilocalories, not the kilojoule row');
});

test('the matcher: every word, the food’s own name, raw or cooked — and a dish is never a food', () => {
  const index = indexFoods(FOODS.map(([id, name, v]) => ({ source: 'usda', id: String(id), name, per100: { calories: v[0] } }) as TableFood));
  const first = (lookup: string) => candidates(lookup, index)[0]?.name ?? null;
  assert.equal(first('banana, raw'), 'Bananas, raw');
  assert.equal(first('Banana'), 'Bananas, raw', 'plurals and case');
  assert.equal(first('rice, white, boiled'), 'Rice, white, long-grain, regular, enriched, cooked', 'cooked asked for, cooked given');
  assert.equal(first('rice, white, raw'), 'Rice, white, long-grain, regular, raw, enriched');
  assert.ok(!candidates('rice', index).some((f) => f.name === 'Rice bran, crude'), 'rice is never rice bran');
  assert.equal(first('cheddar cheese'), 'Cheese, cheddar', 'in any order');
  assert.equal(first('olive oil'), 'Oil, olive, salad or cooking');
  assert.equal(first('chicken tikka masala'), null);
  assert.equal(first(''), null);
  assert.deepEqual(words('Courgettes, raw'), ['squash', 'summer', 'zucchini', 'raw'], 'British words in the table’s American');
  assert.equal(plausible(100, 190), true);
  assert.equal(plausible(100, 250), false, 'a table value far from what the AI saw is a wrong match');
  assert.equal(plausible(2, 1), true, 'tiny amounts are not compared as ratios');
});

test('a portion’s figures are the table’s per-100 g scaled, over the AI’s where the table has them', () => {
  const out = scaled({ calories: 89, protein: 1.09, sugar: 12.23, vitaminC: 8.7 }, 120, { calories: 110, protein: 1, freeSugar: 0, fat: 0.4, micros: { iron: 0.3 } });
  assert.deepEqual(out, { calories: 107, protein: 1.3, sugar: 14.7, freeSugar: 0, fat: 0.4, micros: { iron: 0.3, vitaminC: 10.44 } });
});

when('the server downloads the table once, and meals are grounded in it where a plain food matches', async () => {
  const url = `http://127.0.0.1:${(files.address() as AddressInfo).port}/usda.zip`;
  assert.equal(await importUsda(url, 1), 6);
  assert.equal((await tableFoods()).length, 6, 'read back, fresh after the import');
  const recorded = await query<{ foods: number; url: string }>(`select foods, url from food_table_imports where source = 'usda'`);
  assert.deepEqual(recorded, [{ foods: 6, url }]);
  await assert.rejects(importUsda(url), /only 6 foods/, 'a thin download is refused rather than loaded');

  const item = (name: string, lookup: string, grams: number, calories: number) => ({ name, lookup, grams, portion: '1', nutrients: { calories, protein: 1, carbs: 1, fat: 1, fibre: 1 } });
  const meal: ModelMeal = {
    title: 'Lunch',
    items: [
      item('Banana', 'banana, raw', 120, 110),
      item('Rice', 'rice', 200, 250), // raw rice would be 730 kcal: the cooked row is the one that fits
      item('Chicken tikka masala', '', 350, 480),
      item('Cheddar', 'cheddar cheese', 30, 400), // the AI thought 400 kcal: too far from 121 to trust the match
    ],
  };
  const grounded = await groundMeal(meal);
  const [banana, rice, curry, cheese] = grounded.items!;
  assert.equal(banana.nutrients?.calories, 107);
  assert.deepEqual(banana.source, { table: 'usda', id: '173944', name: 'Bananas, raw' });
  assert.equal(rice.nutrients?.calories, 260);
  assert.equal(rice.source?.name, 'Rice, white, long-grain, regular, enriched, cooked');
  assert.deepEqual(curry, meal.items![2], 'a dish keeps the AI’s figures');
  assert.deepEqual(cheese, meal.items![3], 'a match the AI’s reading disagrees with is not used');
});
