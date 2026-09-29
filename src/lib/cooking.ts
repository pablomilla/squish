/**
 * What each cooking step does, for cook mode to draw it and time it.
 *
 * The model labels every step it writes with one of these, whatever language
 * the step is in, and says how many minutes to set a timer for. Steps written
 * before it did are read here instead, by their words — English only, and a
 * guess, which is why the model is asked.
 */
export const STEP_ACTIONS = ['prep', 'rinse', 'mix', 'season', 'boil', 'fry', 'bake', 'grill', 'blend', 'rest', 'serve'] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

export interface StepDetail {
  action: StepAction;
  /** Minutes to set a timer for; absent when the step has nothing to wait for. */
  minutes?: number;
}

export const isStepAction = (value: unknown): value is StepAction => STEP_ACTIONS.includes(value as StepAction);

/** Checked in order: "bring to the boil, then simmer" is boiling, however it was chopped first. */
const WORDS: [StepAction, RegExp][] = [
  ['bake', /\b(bake|roast|oven)\b/i],
  ['grill', /\b(grill|broil|barbecue|bbq|griddle)\b/i],
  ['boil', /\b(boil|simmer|bubble|poach|steam|blanch|pasta|rice|noodles)\b/i],
  ['fry', /\b(fry|frying|sauté|saute|sear|brown|stir-fry|pan|skillet|wok)\b/i],
  ['blend', /\b(blend|blitz|puree|purée|smoothie|food processor)\b/i],
  ['rinse', /\b(rinse|drain|wash)\b/i],
  ['season', /\b(season|salt|pepper|sprinkle|spice)\b/i],
  ['mix', /\b(mix|stir|whisk|combine|toss|fold)\b/i],
  ['rest', /\b(rest|cool|chill|marinate|leave|set aside|soak)\b/i],
  ['serve', /\b(serve|plate|top with|enjoy)\b/i],
  ['prep', /\b(chop|slice|dice|cut|peel|grate|mince|halve)\b/i],
];

/** A step's detail from its words, for steps written before the model labelled them. */
export function guessDetail(step: string): StepDetail {
  const action = WORDS.find(([, re]) => re.test(step))?.[0] ?? 'prep';
  // The longest time in it, taking the top of a range: "10–12 minutes" is 12.
  let minutes: number | undefined;
  for (const m of step.matchAll(/(\d+)(?:\s*[–-]\s*(\d+))?\s*(?:min|minute)/gi)) {
    const n = Number(m[2] ?? m[1]);
    if (n > 0 && n <= 240 && (!minutes || n > minutes)) minutes = n;
  }
  return { action, ...(minutes ? { minutes } : {}) };
}

/**
 * What cook mode shows for each step: the model's labels where it gave them,
 * a guess where it did not — then, given the ingredients, following the food.
 */
export function detailsFor(steps: string[], detail?: StepDetail[], items?: { name: string }[]): StepDetail[] {
  const details = steps.map((step, i) => {
    const given = detail?.[i];
    return given && isStepAction(given.action) ? given : guessDetail(step);
  });
  return items?.length ? followTheFood(steps, details, items) : details;
}

/** Where food cooks, and so what the picture shows it in. */
const COOKING = new Set<StepAction>(['boil', 'fry', 'bake', 'grill']);

/**
 * "Simmer" is labelled boil, and boil is pictured as a saucepan of water. But
 * adding tomatoes to the browned turkey and simmering them happens in the
 * frying pan, and a saucepan there says it goes in with the pasta. So a
 * simmering step goes where its food already is: with something last cooked
 * in the frying pan, and nothing from the pot, it is the frying pan. A sauce
 * simmering after frying is too, whatever it names.
 */
function followTheFood(steps: string[], details: StepDetail[], items: { name: string }[]): StepDetail[] {
  const where = new Map<string, StepAction>();
  let lastCooked: StepAction | undefined;
  return details.map((detail, i) => {
    const using = usedIn(steps[i], items).map((item) => item.name);
    let action = detail.action;
    if (action === 'boil') {
      const already = using.map((name) => where.get(name));
      const inPan = already.includes('fry');
      const inPot = already.includes('boil');
      const sauce = !already.some(Boolean) && lastCooked === 'fry' && /\bsauce\b/i.test(steps[i]);
      if ((inPan && !inPot) || sauce) action = 'fry';
    }
    if (COOKING.has(action)) {
      for (const name of using) where.set(name, action);
      lastCooked = action;
    }
    return action === detail.action ? detail : { ...detail, action };
  });
}

/** Words in a food's name that say nothing about which food it is. */
const VAGUE = new Set(['fresh', 'large', 'small', 'medium', 'dried', 'frozen', 'tinned', 'canned', 'cooked', 'chopped', 'sliced', 'whole', 'light', 'plain', 'lean', 'skinless', 'boneless', 'free-range', 'organic', 'mixed', 'baby']);

/**
 * The foods a step uses, by name: the plan's own ingredients, in the words
 * both were written in. A name is found whole, or by any word of it long and
 * particular enough to mean something ("rice" for "basmati rice", "pepper"
 * for "red pepper"), as a whole word.
 */
export function usedIn<T extends { name: string }>(step: string, items: T[]): T[] {
  const text = ` ${step.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ')} `;
  return items.filter((item) => {
    const name = item.name.trim().toLocaleLowerCase();
    if (!name) return false;
    if (text.includes(name)) return true;
    return name
      .split(/[\s,()/]+/)
      .filter((w) => w.length >= 4 && !VAGUE.has(w))
      .some((w) => text.includes(` ${w} `) || text.includes(` ${w}s `));
  });
}
