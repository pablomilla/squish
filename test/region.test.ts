import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  REGIONS,
  detectRegion,
  regionFromTimeZone,
  guessRegion,
  TIME_ZONES,
  energyUnitOf,
  energyValue,
  formatEnergy,
  formatPrice,
  localWords,
  regionOf,
  setCurrentRegion,
  toKcal,
  weeklyPrice,
} from '../src/lib/region';
import { foodById, searchFoods, toFoodItem } from '../src/lib/foods';
import { equivalentFor } from '../src/lib/equivalents';
import { formatWeight, imperialLabel, stonePoundsToKg } from '../src/lib/units';
import { stickerById } from '../src/lib/shareDecor';
import { sceneById } from '../src/lib/scenes';
import { achievementById } from '../src/lib/achievements';

/**
 * Regions: the six countries, and the things that change between them —
 * money, energy, salt, weights and the names of food.
 */
afterEach(() => setCurrentRegion({}));

test('the browser’s language picks the country, and anything unplaced is Britain', () => {
  assert.equal(detectRegion(['en-AU', 'en-GB']), 'AU');
  assert.equal(detectRegion('en-US'), 'US');
  assert.equal(detectRegion(['fr-FR', 'en_NZ']), 'NZ');
  assert.equal(detectRegion(['en-UK']), 'GB');
  assert.equal(detectRegion(['en']), 'GB');
  assert.equal(detectRegion(undefined), 'GB');
});

test('a profile from before regions is British, not a guess', () => {
  assert.equal(regionOf({}), 'GB');
  assert.equal(regionOf({ region: 'CA' }), 'CA');
  assert.equal(regionOf({ region: 'XX' as never }), 'GB');
});

test('Australia and New Zealand count in kilojoules unless somebody says otherwise', () => {
  assert.equal(energyUnitOf({ region: 'AU' }), 'kJ');
  assert.equal(energyUnitOf({ region: 'NZ' }), 'kJ');
  assert.equal(energyUnitOf({ region: 'US' }), 'kcal');
  assert.equal(energyUnitOf({ region: 'AU', energy: 'kcal' }), 'kcal');
  assert.equal(energyValue(2000, 'kJ'), 8368);
  assert.equal(toKcal(8368, 'kJ'), 2000);
  assert.equal(formatEnergy(2000, 'kJ', 'en-AU'), '8,368 kJ');
  assert.equal(formatEnergy(1850, 'kcal', 'en-GB'), '1,850 kcal');
});

test('the formatters follow the current region', () => {
  setCurrentRegion({ region: 'AU' });
  assert.equal(formatEnergy(100), '418 kJ');
  setCurrentRegion({ region: 'AU', energy: 'kcal' });
  assert.equal(formatEnergy(100), '100 kcal');
});

test('prices are shown in local money', () => {
  assert.equal(formatPrice(REGIONS.GB.price.monthly, 'GB'), '£6.99');
  assert.equal(formatPrice(REGIONS.IE.price.monthly, 'IE'), '€7.99');
  assert.equal(formatPrice(REGIONS.US.price.yearly, 'US'), '$59.99');
  assert.equal(weeklyPrice('GB'), '£0.97');
  for (const region of Object.values(REGIONS)) {
    // A year is always the better deal, and the prices end in .99 like a shop's.
    assert.ok(region.price.yearly < region.price.monthly * 12, region.id);
    assert.match(region.price.monthly.toFixed(2), /\.99$/);
  }
});

test('only the British and Irish read salt in grams and weigh themselves in stones', () => {
  const salt = Object.values(REGIONS).filter((r) => r.salt === 'salt').map((r) => r.id);
  const stone = Object.values(REGIONS).filter((r) => r.weight === 'stone').map((r) => r.id);
  assert.deepEqual(salt, ['GB', 'IE']);
  assert.deepEqual(stone, ['GB', 'IE']);
});

test('an imperial weight is stones in Britain and plain pounds in America', () => {
  const kg = stonePoundsToKg(11, 4);
  assert.equal(formatWeight(kg, 'imperial'), '11 st 4 lb');
  assert.equal(imperialLabel(), 'ft / st');
  setCurrentRegion({ region: 'US' });
  assert.equal(formatWeight(kg, 'imperial'), '158 lb');
  assert.equal(imperialLabel(), 'ft / lb');
  assert.equal(formatWeight(kg, 'metric'), '71.7 kg', 'metric is metric everywhere');
});

test('British words become local ones in a single pass', () => {
  assert.equal(localWords('Chips and crisps', 'US'), 'Fries and chips');
  assert.equal(localWords('Chips and crisps', 'AU'), 'Hot chips and chips');
  assert.equal(localWords('Chips and crisps', 'GB'), 'Chips and crisps');
  assert.equal(localWords('How can I eat more fibre?', 'US'), 'How can I eat more fiber?');
  assert.equal(localWords('How can I eat more fibre?', 'CA'), 'How can I eat more fibre?');
  assert.equal(localWords('a fizzy drink', 'CA'), 'a pop');
  // Whole words only: "tinsel" is not a can.
  assert.equal(localWords('tinsel', 'US'), 'tinsel');
});

test('foods carry their local names and sizes, and the British name still finds them', () => {
  setCurrentRegion({ region: 'US' });
  assert.equal(foodById('chips')?.name, 'French fries');
  assert.equal(foodById('cola')?.servingG, 355);
  assert.equal(searchFoods('crisps', 1)[0]?.id, 'crisps');
  assert.equal(searchFoods('chips', 1)[0]?.name, 'Potato chips');
  const item = toFoodItem(foodById('cola', 'GB')!);
  assert.equal(item.grams, 355, 'a British record logged in America is an American can');

  setCurrentRegion({ region: 'AU' });
  assert.equal(foodById('granola-bar')?.name, 'Muesli bar');
  assert.equal(searchFoods('hot chips', 1)[0]?.id, 'chips');

  setCurrentRegion({});
  assert.equal(foodById('chips')?.name, 'Chips / fries');
  assert.equal(foodById('cola')?.servingG, 330);
});

test('food comparisons use local words', () => {
  setCurrentRegion({ region: 'US' });
  const found = [0, 1, 2, 3].map((seed) => equivalentFor('protein', 50, seed)?.amount ?? '');
  assert.ok(found.every((amount) => !/\btins?\b/.test(amount)), found.join(' / '));
});

test('the shopping list knows North American and Antipodean names', async () => {
  const { aisleOf } = await import('../src/lib/shopping');
  assert.equal(aisleOf('Shrimp'), 'meat-fish');
  assert.equal(aisleOf('Zucchini'), 'fruit-veg');
  assert.equal(aisleOf('Red capsicum'), 'fruit-veg');
  assert.equal(aisleOf('Cilantro'), 'fruit-veg');
  assert.equal(aisleOf('Tortilla chips'), 'cupboard');
  assert.equal(aisleOf('Ground beef'), 'meat-fish');
});

test('a time zone names its country, if it is one of the six', () => {
  assert.equal(regionFromTimeZone('Europe/London'), 'GB');
  assert.equal(regionFromTimeZone('Europe/Dublin'), 'IE');
  assert.equal(regionFromTimeZone('America/Chicago'), 'US');
  assert.equal(regionFromTimeZone('America/Indiana/Indianapolis'), 'US');
  assert.equal(regionFromTimeZone('Pacific/Honolulu'), 'US');
  assert.equal(regionFromTimeZone('America/Toronto'), 'CA');
  assert.equal(regionFromTimeZone('America/St_Johns'), 'CA');
  assert.equal(regionFromTimeZone('Australia/Perth'), 'AU');
  assert.equal(regionFromTimeZone('Pacific/Chatham'), 'NZ');
  assert.equal(regionFromTimeZone('US/Eastern'), 'US', 'old aliases still reported by some systems');
  assert.equal(regionFromTimeZone('Europe/Paris'), null);
  assert.equal(regionFromTimeZone('America/Mexico_City'), null, 'the Americas are not all America');
  assert.equal(regionFromTimeZone('Australian'), null, 'a prefix only matches whole parts');
  assert.equal(regionFromTimeZone(''), null);
});

test('every zone in the table is one the runtime knows, and no zone is in two countries', () => {
  const seen = new Map<string, string>();
  for (const [region, entries] of Object.entries(TIME_ZONES)) {
    for (const entry of entries) {
      assert.ok(!seen.has(entry), `${entry} is in ${seen.get(entry)} and ${region}`);
      seen.set(entry, region);
      if (entry.endsWith('/')) continue;
      assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: entry }), `${entry} is not a time zone`);
    }
  }
  // And the runtime's own list for each country is covered.
  const known = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  for (const zone of ['America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax', 'America/Anchorage', 'Australia/Sydney', 'Pacific/Auckland']) {
    if (known.includes(zone)) assert.ok(regionFromTimeZone(zone), `${zone} has no country`);
  }
});

test('a new person’s country is their clock’s first, then their languages’', () => {
  assert.equal(guessRegion('Europe/London', ['en-US', 'en']), 'GB', 'a British clock beats an American browser');
  assert.equal(guessRegion('America/Toronto', 'en-US'), 'CA');
  assert.equal(guessRegion('Europe/Paris', ['en-AU']), 'AU', 'a clock outside the six says nothing');
  assert.equal(guessRegion(undefined, 'en-NZ'), 'NZ');
  assert.equal(guessRegion(null, undefined), 'GB');
});

test('sweets are lollies, and an ice lolly an icy pole or an ice block, down under', () => {
  assert.equal(localWords('far higher than sweets and bars', 'AU'), 'far higher than lollies and bars');
  assert.equal(localWords('Sweets', 'NZ'), 'Lollies');
  assert.equal(localWords('Ice lolly', 'AU'), 'Icy pole');
  assert.equal(localWords('Ice lolly', 'NZ'), 'Ice block');
  assert.equal(localWords('Ice-lolly stand', 'AU'), 'Icy-pole stand');
  assert.equal(localWords('Ice-lolly stand', 'NZ'), 'Ice-block stand');
  assert.equal(localWords('Sweet shop', 'AU'), 'Lolly shop');
  assert.equal(localWords('Sweet potato, baked', 'NZ'), 'Kūmara, baked');
  assert.equal(localWords('Sweet potato, baked', 'AU'), 'Sweet potato, baked', 'Australians say sweet potato');
  assert.equal(localWords('a cereal bar and mangetout', 'NZ'), 'a muesli bar and snow peas');
  assert.equal(localWords('Sweets', 'GB'), 'Sweets');
  assert.equal(localWords('Sweets', 'IE'), 'Sweets');
});

test('sticker and scene names follow the country when shown, not when loaded', () => {
  const sticker = stickerById('ice-lolly')!;
  const scene = sceneById('sweet-shop')!;
  assert.equal(sticker.name, 'Ice lolly');
  assert.equal(scene.name, 'Sweet shop');
  setCurrentRegion({ region: 'AU' });
  assert.equal(sticker.name, 'Icy pole');
  assert.equal(stickerById('sweets')!.name, 'Lollies');
  assert.equal(scene.name, 'Lolly shop');
  assert.equal(sceneById('ice-lolly-stand')!.name, 'Icy-pole stand');
  setCurrentRegion({ region: 'NZ' });
  assert.equal(sticker.name, 'Ice block');
});

test('Canada spells the British way but says math, two weeks and takeout', () => {
  assert.equal(localWords("snap a meal and I'll do the maths.", 'CA'), "snap a meal and I'll do the math.");
  assert.equal(localWords('Fortnight', 'CA'), 'Two weeks');
  assert.equal(localWords('a takeaway and a jacket potato', 'CA'), 'a takeout and a baked potato');
  assert.equal(localWords('Semi-skimmed milk and spring onions', 'CA'), '2% milk and green onions');
  assert.equal(localWords('double cream or single cream', 'CA'), 'whipping cream or table cream');
  assert.equal(localWords('icing sugar', 'CA'), 'icing sugar', 'Canadians say icing sugar');
  assert.equal(localWords('How can I eat more fibre?', 'CA'), 'How can I eat more fibre?', 'and spell fibre');
  for (const region of ['GB', 'IE', 'AU', 'NZ'] as const) {
    assert.equal(localWords("the maths, a fortnight, a takeaway", region), 'the maths, a fortnight, a takeaway', `${region} keeps them`);
  }
});

test('the two-week badge is "Two weeks" in Canada, and a fortnight elsewhere, when shown', () => {
  const badge = achievementById('streak-14')!;
  assert.equal(badge.title, 'Fortnight');
  setCurrentRegion({ region: 'CA' });
  assert.equal(badge.title, 'Two weeks');
  setCurrentRegion({ region: 'AU' });
  assert.equal(badge.title, 'Fortnight');
  assert.equal(badge.description, 'Two weeks of logging');
});
