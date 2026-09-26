/**
 * Where the person asking lives, for the prompts.
 *
 * The app sends its region and energy unit on every call (X-Squish-Region,
 * X-Squish-Energy). They are held for the length of the request here rather
 * than threaded through every function between the route and the model, and
 * each prompt adds `regionNote` for the job in hand.
 *
 * What changes is only ever words: the variety of English, what foods are
 * called, how a packet there is laid out and which units to talk in. The
 * JSON the model returns keeps one meaning everywhere — kcal and milligrams
 * of sodium — so a diary logged in Sydney reads the same in Leeds.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { HOME_REGION, REGIONS, isRegion, type EnergyUnit, type Region } from '../src/lib/region';

export interface Place {
  region: Region;
  energy: EnergyUnit;
}

const store = new AsyncLocalStorage<Place>();

/** From the headers, trusting nothing: an unknown region is Britain, an unknown unit the region's own. */
export function placeFrom(regionHeader: unknown, energyHeader: unknown): Place {
  const region = isRegion(regionHeader) ? regionHeader : HOME_REGION;
  const energy = energyHeader === 'kJ' || energyHeader === 'kcal' ? energyHeader : REGIONS[region].energy;
  return { region, energy };
}

export function withPlace(req: Request, _res: Response, next: NextFunction): void {
  store.run(placeFrom(req.get('x-squish-region'), req.get('x-squish-energy')), next);
}

/** The place of the request being served; Britain outside one. */
export const currentPlace = (): Place => store.getStore() ?? { region: HOME_REGION, energy: 'kcal' };

/** For a test or a script that wants a place without a request. */
export const inPlace = <T>(place: Place, fn: () => T): T => store.run(place, fn);

/** How each country's packets set out their numbers, for reading one. */
const LABELS: Record<'uk' | 'us' | 'anz', string> = {
  uk: `- A British or Irish label gives energy in kJ and kcal: use the kcal figure.
- It states SALT in grams; the sodium field wants milligrams. Sodium mg is the salt figure in grams multiplied by 400. Do not copy the salt grams into sodium.
- Its "Carbohydrate" does not include fibre, which is listed on its own line. The carbs field is total carbohydrate, so add the fibre figure to it. "of which sugars" is total sugars.
- "Fat, of which saturates" gives both figures: the first is fat, the indented one is satFat. The label does not state free sugars, so work freeSugar out from the ingredients list — for most packaged food nearly all of its sugar is free, but not for plain dairy or dried fruit.`,
  us: `- An American or Canadian Nutrition Facts panel gives Calories, which are kcal: use them as they are.
- Sodium is already in milligrams: copy it into sodium.
- "Total Carbohydrate" already includes dietary fiber: use it as it is for carbs, and the fiber line for fibre. "Total Sugars" is sugar.
- "Includes Xg Added Sugars" is the free sugar figure; add any fruit juice concentrate in the ingredients to it. Where there is no added sugars line (older Canadian panels), work freeSugar out from the ingredients.
- "Saturated Fat" is satFat. The serving size is given in household terms with grams in brackets; use the grams.`,
  anz: `- An Australian or New Zealand Nutrition Information Panel has a per-serving and a per-100 g column. Energy is in kJ; the calories field wants kcal, so use a Cal figure if one is printed and otherwise divide the kJ by 4.184.
- Sodium is already in milligrams: copy it into sodium.
- Its "Carbohydrate" does not include dietary fibre, which is listed on its own line when claimed. The carbs field is total carbohydrate, so add the fibre figure to it. "– sugars" is total sugars.
- "– saturated" under fat is satFat. If an "added sugars" line is printed, that is freeSugar; otherwise work it out from the ingredients list.`,
};

/** How much a nutritionist's advice there leans on, in a line. */
const ADVICE: Record<'uk' | 'us' | 'anz', string> = {
  uk: 'the NHS Eatwell Guide and SACN',
  us: 'the Dietary Guidelines for Americans (or, in Canada, Canada’s Food Guide)',
  anz: 'the Australian Dietary Guidelines (or, in New Zealand, the Ministry of Health’s Eating and Activity Guidelines)',
};

const FORTIFIED: Record<Region, string> = {
  GB: 'British flour is fortified with iron, calcium, thiamin and niacin (and folic acid from the end of 2026); most breakfast cereals are fortified further.',
  IE: 'Irish breakfast cereals are widely fortified with iron, folic acid and B vitamins; flour mostly is not.',
  US: 'American "enriched" flour, bread and pasta carry added iron, folic acid and B vitamins, and many cereals and milks are fortified with vitamin D.',
  CA: 'Canadian white flour is enriched with iron, folic acid and B vitamins, and all cow’s milk is fortified with vitamin D.',
  AU: 'Australian bread flour carries added folic acid and thiamin, bread is made with iodised salt, and many cereals are fortified.',
  NZ: 'New Zealand bread flour carries added folic acid, bread is made with iodised salt, and many cereals are fortified.',
};

export type NoteFor = 'meal' | 'label' | 'recipe' | 'coach' | 'chat' | 'plan';

/**
 * The paragraph a prompt ends with. `for` picks what is worth saying: a label
 * reader needs the layout of a packet, a meal plan needs the shops.
 */
export function regionNote(kind: NoteFor, place: Place = currentPlace()): string {
  const info = REGIONS[place.region];
  const words = `Write in ${info.english}. Name foods the way people there do.`;
  const energy =
    place.energy === 'kJ'
      ? 'They count energy in kilojoules. Whenever you mention energy in words, give it in kJ (kcal × 4.184, rounded); never write kcal or calories to them.'
      : 'They count energy in calories (kcal).';
  const salt =
    info.salt === 'sodium'
      ? 'Their packets give sodium in milligrams, so talk about sodium in mg (salt in grams × 400), not salt in grams.'
      : 'Their packets give salt in grams, so talk about salt in grams.';
  const json = 'The JSON fields keep their stated units whatever the country: calories in kcal, sodium in milligrams.';
  const lines = [`Where they live: ${info.name}.`, words];

  switch (kind) {
    case 'meal':
    case 'recipe':
      lines.push(`Typical portions and products are the ones sold there. ${FORTIFIED[place.region]}`, json);
      break;
    case 'label':
      lines.push('Reading the label:', LABELS[info.guidance], json);
      break;
    case 'coach':
      lines.push(energy);
      break;
    case 'chat':
      lines.push(
        energy,
        salt,
        `The diary figures you are given are in kcal and grams of salt; convert them when you talk about them. Where official advice comes into it, go by ${ADVICE[info.guidance]}.`,
      );
      break;
    case 'plan':
      lines.push(
        `Plan everyday home cooking from ${info.shops}, with ingredients under the names they are sold by there, so the shopping list reads like a local one.`,
        json,
      );
      break;
  }
  return lines.join('\n');
}
