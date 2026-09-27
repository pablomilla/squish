import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { cofidFoods, cofidNumber, csvFields, findCofidUrl, importCofid, importUsda, readUsdaZip, tableFoods, type TableFood } from '../server/foodTable';
import { candidates, indexFoods, plausible, words } from '../server/foodMatch';
import { groundMeal, scaled, tableOrder } from '../server/grounding';
import { inPlace } from '../server/region';
import { columnIndex, readWorkbook, sharedStrings, sheetRows, unescapeXml } from '../server/xlsx';
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

/*
 * CoFID, cut down: several sheets, a header row that names each column with
 * its unit, a row of codes under it, "Tr" and "N", bracketed estimates, and
 * saturates given both per 100 g of fatty acids and per 100 g of food.
 */
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function xlsx(sheets: { name: string; rows: (string | number)[][] }[]): Buffer {
  const strings: string[] = [];
  const cell = (value: string | number, ref: string) => {
    if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
    if (value === '') return '';
    // Every other string inline, to read both kinds.
    if (strings.length % 2 === 1) {
      strings.push('');
      return `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
    }
    strings.push(value);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const letters = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
  const files: Record<string, string> = {
    'xl/workbook.xml': `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((sheet, i) => `<sheet name="${esc(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${sheet.rows
      .map((row, r) => `<row r="${r + 1}">${row.map((value, c) => cell(value, `${letters(c)}${r + 1}`)).join('')}</row>`)
      .join('')}</sheetData></worksheet>`;
  });
  files['xl/sharedStrings.xml'] = `<sst>${strings.map((text) => `<si><t>${esc(text)}</t></si>`).join('')}</sst>`;
  return zip(files);
}
const COFID_SHEETS = [
  { name: 'Factors', rows: [['Nothing to see here'], ['1', '2']] },
  {
    name: '1.3 Proximates',
    rows: [
      ['Food Code', 'Food Name', 'Description', 'Group', 'Protein (g)', 'Fat (g)', 'Carbohydrate (g)', 'Energy (kcal) (kcal)', 'Energy (kJ) (kJ)', 'Total sugars (g)', 'NSP (g)', 'AOAC fibre (g)'],
      ['', '', '', '', 'PROT', 'FAT', 'CHO', 'KCALS', 'KJ', 'TOTSUG', 'NSP', 'AOACFIB'],
      ['13-128', 'Bananas, flesh only', '', 'FA', 1.2, 0.1, 20.3, 81, 348, 18.1, 1.1, 1.4],
      ['12-345', 'Milk, semi-skimmed, pasteurised, average', '', 'BA', 3.5, 1.7, 4.7, 47, 197, 4.7, 0, 'N'],
      ['11-123', 'Rice, white, basmati, boiled in unsalted water', '', 'AC', 2.6, 0.4, 'Tr', 123, 520, '(0.1)', 'Tr', 'N'],
      ['50-001', 'Infant formula, powder', '', 'X', 12, 27, 55, 500, 2100, 50, 0, 0],
      ['17-999', 'Stock cube, no energy given', '', 'X', 1, 1, 1, 'N', 'N', 1, 0, 0],
    ],
  },
  {
    name: '1.4 Inorganics',
    rows: [
      ['Food Code', 'Food Name', 'Sodium (mg)', 'Calcium (mg)', 'Iron (mg)'],
      ['13-128', 'Bananas, flesh only', 1, 6, 0.3],
      ['12-345', 'Milk, semi-skimmed, pasteurised, average', 43, 120, 'Tr'],
    ],
  },
  {
    name: '1.5 Vitamins',
    rows: [
      ['Food Code', 'Food Name', 'Vitamin D (µg)', 'Vitamin B12 (µg)', 'Folate (µg)', 'Vitamin C (mg)'],
      ['13-128', 'Bananas, flesh only', 0, 0, 14, 11],
      ['12-345', 'Milk, semi-skimmed, pasteurised, average', 'Tr', 0.9, 9, 2],
    ],
  },
  {
    name: '1.8 (SFA) FA per 100g food',
    rows: [
      ['Food Code', 'Food Name', 'Satd FA /100g FA (g)', 'Satd FA /100g fd (g)'],
      ['12-345', 'Milk, semi-skimmed, pasteurised, average', 65, 1.1],
    ],
  },
];

let files: Server;
let dir: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'squish-foods-test-'));
  await writeFile(join(dir, 'usda.zip'), usdaZip());
  await writeFile(join(dir, 'cofid.xlsx'), xlsx(COFID_SHEETS));
  await writeFile(
    join(dir, 'page'),
    '<a href="https://assets.example/media/abc/CoFID_user_guide.xlsx">Guide</a> ' +
      '<a href="/media/def/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx">The dataset</a>',
  );
  files = createServer(async (req, res) => {
    const name = (req.url ?? '').split('/').pop() ?? '';
    const file = name.endsWith('.xlsx') ? 'cofid.xlsx' : name === 'page' ? 'page' : 'usda.zip';
    res.end(await readFile(join(dir, file)));
  });
  await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', () => resolve()));
  if (enabled) await migrate();
});
after(async () => {
  files.close();
  await rm(dir, { recursive: true, force: true });
  if (enabled) {
    await query(`delete from food_table where source in ('usda', 'cofid')`);
    await query(`delete from food_table_imports where source in ('usda', 'cofid')`);
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

test('an Excel workbook: shared and inline strings, entities, gaps between cells', async () => {
  assert.equal(unescapeXml('Fish &amp; chips &lt;3 &#233;&#x2019;'), 'Fish & chips <3 é’');
  assert.deepEqual([columnIndex('A'), columnIndex('Z'), columnIndex('AA'), columnIndex('AB')], [0, 25, 26, 27]);
  assert.deepEqual(sharedStrings('<sst><si><t>Plain</t></si><si><r><t>Rich </t></r><r><t xml:space="preserve">text</t></r></si></sst>'), ['Plain', 'Rich text']);
  assert.deepEqual(sheetRows('<sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="C1"><v>4.5</v></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>x</t></is></c></row></sheetData>', ['a', 'b']), [
    ['b', '', '4.5'], [], ['', 'x'],
  ]);
  const sheets = await readWorkbook(join(dir, 'cofid.xlsx'));
  assert.deepEqual(sheets.map((sheet) => sheet.name), COFID_SHEETS.map((sheet) => sheet.name));
  assert.equal(sheets[1].rows[2][1], 'Bananas, flesh only');
});

test('CoFID’s sheets become foods per 100 g, joined by food code, read by their headers', async () => {
  assert.equal(cofidNumber('Tr'), 0, 'a trace is nought');
  assert.equal(cofidNumber('N'), undefined, 'not measured is nothing');
  assert.equal(cofidNumber('(0.1)'), 0.1, 'an estimate is a number');
  const foods = cofidFoods(await readWorkbook(join(dir, 'cofid.xlsx')));
  assert.deepEqual(foods.map((food) => food.name).sort(), [
    'Bananas, flesh only', 'Milk, semi-skimmed, pasteurised, average', 'Rice, white, basmati, boiled in unsalted water',
  ], 'infant formula and a food with no energy figure left out');
  const milk = foods.find((food) => food.id === '12-345')!;
  assert.deepEqual(milk, {
    source: 'cofid', id: '12-345', name: 'Milk, semi-skimmed, pasteurised, average',
    per100: { protein: 3.5, fat: 1.7, carbs: 4.7, calories: 47, sugar: 4.7, sodium: 43, calcium: 120, iron: 0, vitaminD: 0, vitaminB12: 0.9, folate: 9, vitaminC: 2, satFat: 1.1 },
  }, 'kcal not kJ, AOAC fibre left out when not measured (not NSP instead), saturates per 100 g of food');
  assert.equal(foods.find((food) => food.id === '11-123')!.per100.carbs, 0);
});

test('the CoFID workbook is found on its gov.uk page, whatever this release calls it', async () => {
  const base = `http://127.0.0.1:${(files.address() as AddressInfo).port}`;
  assert.equal(await findCofidUrl(`${base}/page`), `${base}/media/def/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx`);
});

test('Britain, Ireland, Australia and New Zealand ask the UK table first; the US and Canada the USDA', () => {
  assert.deepEqual(tableOrder('GB'), ['cofid', 'usda']);
  assert.deepEqual(tableOrder('NZ'), ['cofid', 'usda']);
  assert.deepEqual(tableOrder('US'), ['usda', 'cofid']);
  assert.deepEqual(tableOrder('CA'), ['usda', 'cofid']);
});

when('with both tables loaded, a banana in London is CoFID’s and a banana in Boston is USDA’s', async () => {
  const base = `http://127.0.0.1:${(files.address() as AddressInfo).port}`;
  if (!(await tableFoods()).some((food) => food.source === 'usda')) await importUsda(`${base}/usda.zip`, 1);
  assert.equal(await importCofid(`${base}/cofid.xlsx`, 1), 3);
  const meal: ModelMeal = { items: [{ name: 'Banana', lookup: 'banana, raw', grams: 120, portion: '1', nutrients: { calories: 110, protein: 1, carbs: 25, fat: 0, fibre: 2 } }] };
  const at = (region: 'GB' | 'US') => inPlace({ region, energy: 'kcal', language: 'en' }, () => groundMeal(meal));
  const london = (await at('GB')).items![0];
  assert.deepEqual(london.source, { table: 'cofid', id: '13-128', name: 'Bananas, flesh only' });
  assert.equal(london.nutrients?.calories, 97);
  const boston = (await at('US')).items![0];
  assert.deepEqual(boston.source, { table: 'usda', id: '173944', name: 'Bananas, raw' });
  const milk = await inPlace({ region: 'GB', energy: 'kcal', language: 'en' }, () =>
    groundMeal({ items: [{ name: 'Milk', lookup: 'semi-skimmed milk', grams: 200, portion: '1 glass', nutrients: { calories: 95, protein: 7, carbs: 9, fat: 3, fibre: 0 } }] }),
  );
  assert.equal(milk.items![0].source?.name, 'Milk, semi-skimmed, pasteurised, average', 'a British food only the British table has');
});
