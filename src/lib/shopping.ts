/**
 * The shopping list, made from planned meals.
 *
 * Every food in the plans for the days chosen, the same food added up across
 * meals ("chicken breast" in Monday's stir-fry and Thursday's wrap is one line
 * of 300 g), put in the order a supermarket is walked: fruit and veg first,
 * then the fridge, the bakery, the cupboard, the freezer.
 *
 * The aisle is a guess from the name, and says so by having an "Other" for
 * whatever it cannot place. A wrong guess costs a moment's scrolling; a list
 * in the order foods were planned costs a trip back to the other end of the
 * shop.
 */
import type { MealEntry } from '../types';

export type Aisle = 'fruit-veg' | 'meat-fish' | 'dairy-eggs' | 'bakery' | 'cupboard' | 'frozen' | 'drinks' | 'other';

export const AISLES: { id: Aisle; title: string }[] = [
  { id: 'fruit-veg', title: 'Fruit & veg' },
  { id: 'meat-fish', title: 'Meat & fish' },
  { id: 'dairy-eggs', title: 'Dairy & eggs' },
  { id: 'bakery', title: 'Bakery' },
  { id: 'cupboard', title: 'Cupboard' },
  { id: 'frozen', title: 'Frozen' },
  { id: 'drinks', title: 'Drinks' },
  { id: 'other', title: 'Other' },
];

/** Checked in this order, so "chicken stock" is found in the cupboard before "chicken" puts it with the meat. */
const WORDS: [Aisle, RegExp][] = [
  // Fresh things whose names sound like the cupboard or the freezer.
  ['fruit-veg', /green beans|runner beans|fine beans|broad beans|mangetout|sugar snap|butternut|bell pepper|red pepper|red capsicum|green capsicum|green pepper|yellow pepper/],
  ['frozen', /\bfrozen\b|ice cream|\bpeas\b/],
  ['cupboard', /\bstock\b|\bcube|tinned|canned|\bbeans\b|lentil|chickpea|\brice\b|pasta|spaghetti|noodle|\boats?\b|porridge|cereal|granola|flour|sugar|honey|\bjam\b|peanut butter|\bnuts?\b|almond|cashew|seeds?\b|\boil\b|vinegar|soy sauce|sauce|ketchup|mayo|mustard|spice|curry paste|paprika|cumin|\bsalt\b|black pepper|peppercorn|quinoa|couscous|crisps|potato chips|tortilla chips|chocolate|biscuit|cookie|cracker|muesli bar|granola bar|tomato puree|passata|chopped tomatoes|coconut milk|tuna/],
  ['drinks', /\bjuice\b|\bcoffee\b|\btea\b|\bwater\b|(orange|lemon|blackcurrant) squash|cola|lemonade|\bsoda\b|soft drink|\bpop\b|\bwine\b|\bbeer\b|smoothie/],
  ['meat-fish', /chicken|beef|\bpork\b|\blamb\b|turkey|\bham\b|bacon|sausage|mince|steak|salmon|\bcod\b|haddock|prawn|shrimp|\bfish\b|mackerel|sardine|chorizo|duck/],
  ['dairy-eggs', /\bmilk\b|cheese|cheddar|mozzarella|feta|halloumi|parmesan|yoghurt|yogurt|butter\b|cream\b|\beggs?\b|creme fraiche|crème fraîche|skyr|quark|tofu/],
  ['bakery', /bread|\bloaf\b|\broll\b|\bbuns?\b|bagel|wrap|tortilla|pitta|pita|croissant|muffin|crumpet|naan|sourdough|baguette/],
  ['fruit-veg', /apple|banana|orange|berr(y|ies)|grape|\bpear\b|peach|plum|mango|melon|kiwi|lemon|lime|avocado|tomato|potato|carrot|onion|garlic|ginger|pepper|broccoli|spinach|kale|lettuce|salad|cucumber|courgette|zucchini|aubergine|eggplant|capsicum|kumara|kūmara|mushroom|celery|leek|cabbage|cauliflower|sweetcorn|\bcorn\b|beansprouts|spring onion|herbs?\b|coriander|cilantro|scallion|basil|parsley|chilli|squash|pumpkin|beetroot|\bveg/],
];

export function aisleOf(name: string): Aisle {
  const lower = name.toLowerCase();
  for (const [aisle, words] of WORDS) if (words.test(lower)) return aisle;
  return 'other';
}

export interface ShoppingLine {
  key: string;
  name: string;
  /** "450 g", "1.2 kg", "3 × 1 slice", "2 portions". */
  amount: string;
  aisle: Aisle;
  /** The planned meals it is for, so a line can be traced back. */
  meals: string[];
}

const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** A shop's sort of number: to the nearest 10 g (5 g when small), kilograms past a thousand. */
export function shopAmount(total: number, liquid: boolean): string {
  const unit = liquid ? ['ml', 'litres'] : ['g', 'kg'];
  if (total >= 1000) return `${Math.round(total / 100) / 10} ${unit[1]}`;
  const step = total < 100 ? 5 : 10;
  return `${Math.max(step, Math.round(total / step) * step)} ${unit[0]}`;
}

/** Every food in the plans for `from`..`to` (inclusive), added up and in aisle order. */
export function shoppingList(plans: MealEntry[], from: string, to: string): ShoppingLine[] {
  const lines = new Map<string, { name: string; grams: number; weighed: boolean; liquid: boolean; portions: string[]; meals: Set<string> }>();
  for (const plan of plans) {
    if (plan.date < from || plan.date > to) continue;
    for (const item of plan.items) {
      const key = keyOf(item.name);
      if (!key) continue;
      const line = lines.get(key) ?? { name: item.name.trim(), grams: 0, weighed: true, liquid: Boolean(item.liquid), portions: [], meals: new Set() };
      if (item.grams && item.grams > 0) line.grams += item.grams;
      else line.weighed = false;
      line.portions.push(item.portion.trim());
      line.meals.add(plan.title);
      lines.set(key, line);
    }
  }

  const order = AISLES.map((a) => a.id);
  return [...lines.entries()]
    .map(([key, line]) => {
      let amount: string;
      if (line.weighed && line.grams > 0) amount = shopAmount(line.grams, line.liquid);
      else if (line.portions.length === 1) amount = line.portions[0];
      else if (new Set(line.portions).size === 1) amount = `${line.portions.length} × ${line.portions[0]}`;
      else amount = `${line.portions.length} portions`;
      return { key, name: line.name, amount, aisle: aisleOf(line.name), meals: [...line.meals] };
    })
    .sort((a, b) => order.indexOf(a.aisle) - order.indexOf(b.aisle) || a.name.localeCompare(b.name));
}

export interface Extra {
  id: string;
  name: string;
}

/** The list as plain text, for a message or a notes app. Ticked lines are left off: they are in the basket. */
export function listAsText(lines: ShoppingLine[], extras: Extra[], ticked: Set<string>, heading = 'Shopping list'): string {
  const out = [heading];
  for (const aisle of AISLES) {
    const here = lines.filter((line) => line.aisle === aisle.id && !ticked.has(line.key));
    if (!here.length) continue;
    out.push('', aisle.title);
    for (const line of here) out.push(`- ${line.name} (${line.amount})`);
  }
  const own = extras.filter((extra) => !ticked.has(`extra:${extra.id}`));
  if (own.length) {
    out.push('', 'Also');
    for (const extra of own) out.push(`- ${extra.name}`);
  }
  return out.join('\n');
}
