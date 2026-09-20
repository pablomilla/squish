import type { FoodItem, Nutrients } from '../types';
import { round1 } from './nutrition';

export interface FoodRecord {
  id: string;
  name: string;
  emoji: string;
  /** Default serving label and its weight in grams. */
  serving: string;
  servingG: number;
  /** Per 100 g. */
  per100: Nutrients;
  tags: string[];
}

const f = (
  id: string,
  name: string,
  emoji: string,
  serving: string,
  servingG: number,
  /** kcal, protein, carbs, fat, fibre, sugar, sodium mg, saturated fat. */
  per100: [number, number, number, number, number, number?, number?, number?],
  tags: string[] = [],
): FoodRecord => ({
  id,
  name,
  emoji,
  serving,
  servingG,
  per100: {
    calories: per100[0],
    protein: per100[1],
    carbs: per100[2],
    fat: per100[3],
    fibre: per100[4],
    sugar: per100[5] ?? 0,
    sodium: per100[6] ?? 0,
    // Left off only where the food has no fat at all to divide up.
    satFat: per100[7],
  },
  tags,
});

/** A compact, offline food table — enough to log a real day without a network. */
export const FOODS: FoodRecord[] = [
  f('egg', 'Egg, boiled', '🥚', '1 medium egg', 55, [155, 13, 1.1, 11, 0, 1.1, 124, 3.3], ['protein', 'breakfast']),
  f('egg-scrambled', 'Scrambled eggs', '🍳', '2 eggs', 120, [166, 11, 2, 12, 0, 1.5, 200, 3.7], ['protein', 'breakfast']),
  f('oats', 'Porridge oats, dry', '🥣', '1 dry serving', 50, [379, 13, 68, 6.5, 10, 1, 6, 1.1], ['breakfast', 'fibre', 'porridge', 'oatmeal']),
  f('greek-yog', 'Greek yoghurt, 2%', '🥛', '1 pot', 150, [73, 10, 3.9, 1.9, 0, 3.2, 34, 1.2], ['protein', 'snack', 'yogurt', 'yoghurt']),
  f('milk', 'Semi-skimmed milk', '🥛', '1 glass', 250, [50, 3.4, 4.8, 1.8, 0, 4.8, 44, 1.1], ['drink', 'semi skimmed']),
  f('banana', 'Banana', '🍌', '1 medium', 118, [89, 1.1, 23, 0.3, 2.6, 12, 1, 0.1], ['fruit', 'snack']),
  f('apple', 'Apple', '🍎', '1 medium', 182, [52, 0.3, 14, 0.2, 2.4, 10, 1, 0], ['fruit', 'snack']),
  f('blueberries', 'Blueberries', '🫐', '1 handful', 80, [57, 0.7, 14, 0.3, 2.4, 10, 1, 0], ['fruit']),
  f('strawberries', 'Strawberries', '🍓', '100 g', 100, [32, 0.7, 7.7, 0.3, 2, 4.9, 1, 0], ['fruit']),
  f('orange', 'Orange', '🍊', '1 medium', 140, [47, 0.9, 12, 0.1, 2.4, 9, 0, 0], ['fruit']),
  f('avocado', 'Avocado', '🥑', '1/2 avocado', 100, [160, 2, 8.5, 15, 6.7, 0.7, 7, 2.1], ['fat', 'veg']),
  f('bread', 'Wholemeal bread', '🍞', '1 slice', 40, [247, 13, 41, 3.4, 7, 4.3, 450, 0.7], ['carb', 'toast', 'brown bread']),
  f('white-bread', 'White bread', '🍞', '1 slice', 36, [265, 9, 49, 3.2, 2.7, 5, 490, 0.7], ['carb', 'toast']),
  f('bagel', 'Bagel', '🥯', '1 bagel', 95, [250, 10, 49, 1.5, 2.1, 5, 430, 0.3], ['carb', 'breakfast']),
  f('rice', 'White rice, cooked', '🍚', '1 cup cooked', 160, [130, 2.7, 28, 0.3, 0.4, 0.1, 1, 0.1], ['carb']),
  f('brown-rice', 'Brown rice, cooked', '🍚', '1 cup cooked', 160, [123, 2.7, 26, 1, 1.6, 0.4, 4, 0.2], ['carb', 'fibre']),
  f('pasta', 'Pasta, cooked', '🍝', '1 bowl', 220, [158, 5.8, 31, 0.9, 1.8, 0.6, 1, 0.2], ['carb']),
  f('potato', 'Potato, boiled', '🥔', '1 medium', 170, [87, 1.9, 20, 0.1, 1.8, 0.9, 4, 0], ['carb']),
  f('sweet-potato', 'Sweet potato, baked', '🍠', '1 medium', 150, [90, 2, 21, 0.1, 3.3, 6.5, 36, 0], ['carb', 'fibre']),
  f('chips', 'Chips / fries', '🍟', 'regular portion', 130, [312, 3.4, 41, 15, 3.8, 0.3, 210, 2.3], ['carb', 'treat', 'fries', 'chippy']),
  f('chicken', 'Chicken breast, grilled', '🍗', '1 fillet', 150, [165, 31, 0, 3.6, 0, 0, 74, 1], ['protein', 'breast']),
  f('chicken-thigh', 'Chicken thigh, roasted', '🍗', '1 thigh', 110, [209, 26, 0, 11, 0, 0, 90, 3], ['protein']),
  f('beef-mince', 'Beef mince, 5%', '🥩', '125 g', 125, [176, 26, 0, 8, 0, 0, 70, 3.4], ['protein', 'ground beef', 'mince']),
  f('steak', 'Sirloin steak', '🥩', '1 steak', 200, [217, 27, 0, 12, 0, 0, 60, 4.6], ['protein']),
  f('salmon', 'Salmon fillet', '🐟', '1 fillet', 130, [208, 20, 0, 13, 0, 0, 59, 3.1], ['protein', 'fat']),
  f('tuna', 'Tuna, tinned in water', '🐟', '1 tin', 110, [116, 26, 0, 0.8, 0, 0, 247, 0.2], ['protein']),
  f('prawns', 'Prawns, cooked', '🍤', '100 g', 100, [99, 24, 0.2, 0.3, 0, 0, 111, 0.1], ['protein', 'shrimp']),
  f('tofu', 'Firm tofu', '🧊', '1 block', 150, [144, 17, 2.8, 8.7, 2.3, 0.6, 14, 1.3], ['protein', 'veggie']),
  f('tempeh', 'Tempeh', '🧊', '100 g', 100, [192, 20, 7.6, 11, 4.5, 0, 9, 2.2], ['protein', 'veggie']),
  f('lentils', 'Lentils, cooked', '🫘', '1 cup', 198, [116, 9, 20, 0.4, 7.9, 1.8, 2, 0.1], ['protein', 'fibre', 'veggie']),
  f('chickpeas', 'Chickpeas, cooked', '🫘', '1 cup', 164, [164, 8.9, 27, 2.6, 7.6, 4.8, 7, 0.3], ['protein', 'fibre', 'veggie']),
  f('black-beans', 'Black beans, cooked', '🫘', '1 cup', 172, [132, 8.9, 24, 0.5, 8.7, 0.3, 2, 0.1], ['protein', 'fibre']),
  f('hummus', 'Hummus', '🫙', '2 tbsp', 60, [166, 7.9, 14, 9.6, 6, 0.3, 379, 1.4], ['snack', 'veggie']),
  f('peanut-butter', 'Peanut butter', '🥜', '1 tbsp', 16, [588, 25, 20, 50, 6, 9, 17, 10], ['fat', 'snack', 'pb']),
  f('almonds', 'Almonds', '🌰', '1 handful', 30, [579, 21, 22, 50, 12.5, 4.4, 1, 3.8], ['fat', 'snack']),
  f('walnuts', 'Walnuts', '🌰', '1 handful', 30, [654, 15, 14, 65, 6.7, 2.6, 2, 6.1], ['fat', 'snack']),
  f('olive-oil', 'Olive oil', '🫒', '1 tbsp', 14, [884, 0, 0, 100, 0, 0, 2, 14], ['fat']),
  f('butter', 'Butter', '🧈', '1 tsp', 5, [717, 0.9, 0.1, 81, 0, 0.1, 643, 51], ['fat']),
  f('cheddar', 'Cheddar cheese', '🧀', '30 g', 30, [402, 25, 1.3, 33, 0, 0.5, 621, 21], ['fat', 'protein']),
  f('mozzarella', 'Mozzarella', '🧀', '50 g', 50, [280, 22, 2.2, 21, 0, 1, 627, 12], ['fat', 'protein']),
  f('feta', 'Feta', '🧀', '40 g', 40, [264, 14, 4.1, 21, 0, 4.1, 917, 15], ['fat']),
  f('broccoli', 'Broccoli, steamed', '🥦', '1 portion', 80, [35, 2.4, 7.2, 0.4, 3.3, 1.4, 41, 0.1], ['veg', 'fibre']),
  f('spinach', 'Spinach', '🥬', '1 handful', 80, [23, 2.9, 3.6, 0.4, 2.2, 0.4, 79, 0.1], ['veg']),
  f('salad', 'Mixed salad leaves', '🥗', '1 bowl', 80, [17, 1.4, 2.9, 0.2, 1.8, 1.2, 28, 0], ['veg']),
  f('tomato', 'Tomato', '🍅', '1 medium', 120, [18, 0.9, 3.9, 0.2, 1.2, 2.6, 5, 0], ['veg']),
  f('cucumber', 'Cucumber', '🥒', '100 g', 100, [15, 0.7, 3.6, 0.1, 0.5, 1.7, 2, 0], ['veg']),
  f('carrot', 'Carrot', '🥕', '1 medium', 80, [41, 0.9, 10, 0.2, 2.8, 4.7, 69, 0], ['veg', 'fibre']),
  f('peas', 'Garden peas', '🟢', '1 portion', 80, [81, 5.4, 14, 0.4, 5.1, 5.7, 5, 0.1], ['veg', 'fibre']),
  f('corn', 'Sweetcorn', '🌽', '80 g', 80, [96, 3.4, 21, 1.5, 2.4, 4.5, 15, 0.2], ['veg']),
  f('mushroom', 'Mushrooms, fried', '🍄', '80 g', 80, [78, 3, 4, 5.5, 1.5, 1.5, 12, 0.8], ['veg']),
  f('soup', 'Vegetable soup', '🥣', '1 bowl', 300, [45, 1.8, 7.5, 1.1, 1.4, 2.4, 330, 0.2], ['light']),
  f('sushi', 'Salmon sushi roll', '🍣', '6 pieces', 180, [143, 6, 22, 3.5, 1, 4, 350, 0.8], ['meal']),
  f('burrito', 'Chicken burrito', '🌯', '1 burrito', 380, [195, 11, 22, 7, 2.4, 2, 480, 2.4], ['meal']),
  f('pizza', 'Pizza, cheese & tomato', '🍕', '2 slices', 220, [266, 11, 33, 10, 2.3, 3.6, 598, 4.4], ['meal', 'treat']),
  f('burger', 'Beef burger with bun', '🍔', '1 burger', 250, [254, 14, 20, 13, 1.4, 4, 497, 5], ['meal', 'treat']),
  f('sandwich', 'Chicken salad sandwich', '🥪', '1 sandwich', 200, [210, 13, 22, 8, 2.2, 3, 520, 1.5], ['meal']),
  f('noodles', 'Stir-fried noodles', '🍜', '1 bowl', 330, [155, 6, 24, 4.2, 2, 2.5, 460, 0.8], ['meal']),
  f('curry', 'Chicken curry', '🍛', '1 portion', 350, [135, 12, 6.5, 7, 1.6, 2.5, 380, 2.5], ['meal']),
  f('poke', 'Poke bowl', '🍲', '1 bowl', 400, [130, 9, 15, 3.6, 1.8, 3, 320, 0.7], ['meal']),
  f('chicken-bowl', 'Grilled chicken bowl', '🥗', '1 bowl', 420, [124, 10, 13, 3.3, 1.9, 2.4, 260, 0.7], ['meal']),
  f('protein-shake', 'Protein shake', '🥤', '1 scoop + water', 330, [37, 7.3, 1.2, 0.5, 0.3, 0.6, 30, 0.2], ['protein', 'drink']),
  f('smoothie', 'Berry smoothie', '🥤', '1 glass', 300, [58, 1.4, 12, 0.6, 1.8, 9.5, 12, 0.1], ['drink']),
  f('coffee', 'Coffee with milk', '☕', '1 cup', 240, [18, 1, 1.8, 0.8, 0, 1.8, 15, 0.5], ['drink']),
  f('latte', 'Latte', '☕', '1 medium', 350, [44, 2.4, 4.3, 1.7, 0, 4.3, 30, 1.1], ['drink', 'coffee', 'flat white', 'cappuccino']),
  f('tea', 'Tea, no sugar', '🍵', '1 cup', 240, [1, 0, 0.2, 0, 0, 0, 3, 0], ['drink']),
  f('orange-juice', 'Orange juice', '🧃', '1 glass', 250, [45, 0.7, 10, 0.2, 0.2, 8.4, 1, 0], ['drink', 'oj', 'juice']),
  f('cola', 'Cola', '🥤', '1 can', 330, [42, 0, 10.6, 0, 0, 10.6, 4, 0], ['drink', 'treat', 'coke', 'soda', 'fizzy', 'pop']),
  f('diet-cola', 'Diet cola', '🥤', '1 can', 330, [0.3, 0, 0, 0, 0, 0, 7, 0], ['drink', 'zero', 'coke', 'soda', 'fizzy', 'pop']),
  f('beer', 'Beer', '🍺', '1 pint', 568, [43, 0.5, 3.6, 0, 0, 0, 4, 0], ['drink', 'treat', 'lager', 'ale', 'pint']),
  f('wine', 'Red wine', '🍷', '1 glass', 175, [85, 0.1, 2.6, 0, 0, 0.6, 4, 0], ['drink', 'treat']),
  f('chocolate', 'Milk chocolate', '🍫', '4 squares', 25, [535, 7.6, 59, 30, 3.4, 52, 79, 18], ['treat']),
  f('dark-chocolate', 'Dark chocolate 70%', '🍫', '3 squares', 20, [598, 7.8, 46, 43, 11, 24, 20, 25], ['treat']),
  f('biscuit', 'Digestive biscuit', '🍪', '2 biscuits', 30, [471, 6.8, 63, 21, 3.2, 17, 600, 9.5], ['treat']),
  f('cookie', 'Chocolate chip cookie', '🍪', '1 cookie', 45, [488, 5.1, 64, 24, 2.4, 35, 350, 9], ['treat']),
  f('ice-cream', 'Vanilla ice cream', '🍨', '2 scoops', 120, [207, 3.5, 24, 11, 0.7, 21, 80, 6.8], ['treat']),
  f('crisps', 'Crisps', '🥔', '1 small bag', 30, [536, 6.6, 53, 34, 4.4, 0.6, 525, 3.1], ['treat', 'chips']),
  f('popcorn', 'Popcorn, plain', '🍿', '25 g', 25, [387, 13, 78, 4.5, 15, 0.9, 8, 0.6], ['snack', 'fibre']),
  f('granola-bar', 'Granola bar', '🍫', '1 bar', 40, [430, 7, 64, 15, 5, 25, 190, 5], ['snack']),
  f('pancakes', 'Pancakes with syrup', '🥞', '2 pancakes', 160, [227, 5.2, 38, 6, 1.2, 15, 430, 1.8], ['breakfast', 'treat', 'pancake']),
  f('cereal', 'Bran flakes', '🥣', '1 bowl', 40, [355, 10, 67, 2, 15, 16, 550, 0.4], ['breakfast', 'fibre']),
  f('croissant', 'Croissant', '🥐', '1 croissant', 60, [406, 8.2, 46, 21, 2.6, 11, 424, 12], ['breakfast', 'treat']),
];

export function searchFoods(query: string, limit = 24): FoodRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return FOODS.slice(0, limit);
  const scored = FOODS.map((food) => {
    const name = food.name.toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (food.tags.some((t) => t.includes(q))) score = 30;
    else {
      // Partial word overlap — the more of the query a name covers, the better.
      const matched = q.split(/\s+/).filter((w) => w.length > 2 && name.includes(w)).length;
      if (matched) score = 20 + matched * 12;
    }
    return { food, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length);
  return scored.slice(0, limit).map((x) => x.food);
}

export function foodById(id: string): FoodRecord | undefined {
  return FOODS.find((x) => x.id === id);
}

/** Turn a food record into a logged item at `servings` × its default serving. */
export function toFoodItem(food: FoodRecord, servings = 1): FoodItem {
  const grams = food.servingG * servings;
  const factor = grams / 100;
  const n = food.per100;
  return {
    id: `${food.id}-${Math.random().toString(36).slice(2, 8)}`,
    name: food.name,
    emoji: food.emoji,
    portion: servings === 1 ? food.serving : `${round1(servings)} × ${food.serving}`,
    grams: Math.round(grams),
    liquid: food.tags.includes('drink'),
    nutrients: {
      calories: Math.round(n.calories * factor),
      protein: round1(n.protein * factor),
      carbs: round1(n.carbs * factor),
      fat: round1(n.fat * factor),
      fibre: round1(n.fibre * factor),
      satFat: n.satFat === undefined ? undefined : round1(n.satFat * factor),
      sugar: round1((n.sugar ?? 0) * factor),
      sodium: Math.round((n.sodium ?? 0) * factor),
    },
  };
}
