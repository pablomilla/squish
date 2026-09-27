/**
 * A stand-in for the American English word set, for tests and local checks,
 * where there is no Claude to make the real one.
 *
 * Only the British spellings and words that Squish's own text actually uses
 * (the app, the emails, the website and the privacy policy), found by
 * scanning it, and a few more of the commonest. Whole words only, and the
 * case kept: "Favourite" becomes "Favorite". Placeholders and tags are never
 * touched, so every result passes the same check a real translation does
 * (test/translate-pages.test.ts makes sure of that).
 */

/** British → American, in lower case. */
export const AMERICAN_WORDS: Record<string, string> = {
  // -our
  colour: 'color',
  colours: 'colors',
  colourful: 'colorful',
  colourway: 'colorway',
  flavour: 'flavor',
  flavours: 'flavors',
  favourite: 'favorite',
  favourites: 'favorites',
  behaviour: 'behavior',
  behavioural: 'behavioral',
  // -re
  fibre: 'fiber',
  centre: 'center',
  litre: 'liter',
  litres: 'liters',
  millilitre: 'milliliter',
  millilitres: 'milliliters',
  // -ise, -yse
  analyse: 'analyze',
  analysed: 'analyzed',
  analysing: 'analyzing',
  recognise: 'recognize',
  recognises: 'recognizes',
  recognised: 'recognized',
  unrecognised: 'unrecognized',
  organise: 'organize',
  organised: 'organized',
  personalise: 'personalize',
  personalised: 'personalized',
  customise: 'customize',
  customised: 'customized',
  // other spellings
  cosy: 'cozy',
  fuelled: 'fueled',
  judgement: 'judgment',
  yoghurt: 'yogurt',
  yoghurts: 'yogurts',
  grey: 'gray',
  programme: 'program',
  catalogue: 'catalog',
  towards: 'toward',
  // words
  porridge: 'oatmeal',
  wholemeal: 'whole wheat',
  tinned: 'canned',
  tin: 'can',
  tins: 'cans',
  sweets: 'candy',
  maths: 'math',
  fortnight: 'two weeks',
  biscuit: 'cookie',
  biscuits: 'cookies',
  crisps: 'chips',
  chips: 'fries',
  mince: 'ground beef',
  prawn: 'shrimp',
  prawns: 'shrimp',
  sweetcorn: 'corn',
  courgette: 'zucchini',
  courgettes: 'zucchini',
  aubergine: 'eggplant',
  aubergines: 'eggplants',
  coriander: 'cilantro',
};

const PATTERN = new RegExp(`\\b(${Object.keys(AMERICAN_WORDS).sort((a, b) => b.length - a.length).join('|')})\\b`, 'gi');

/** The same case as the word it replaces: "Crisps" → "Chips", "CRISPS" → "CHIPS". */
function sameCase(found: string, word: string): string {
  if (found === found.toUpperCase() && found.length > 1) return word.toUpperCase();
  if (found[0] === found[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

/**
 * British English as the stand-in's American. One pass, so "crisps and chips"
 * becomes "chips and fries", not "fries and fries". "GP" is a doctor.
 */
export function standInAmerican(text: string): string {
  return text
    .replace(PATTERN, (found) => sameCase(found, AMERICAN_WORDS[found.toLowerCase()]))
    .replace(/\bGPs\b/g, 'doctors')
    .replace(/\bGP\b/g, 'doctor');
}
