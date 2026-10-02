/**
 * What each cooking step does, for cook mode to draw it and time it.
 *
 * The model labels every step it writes with one of these, whatever language
 * the step is in, and says how many minutes to set a timer for. Steps written
 * before it did are read here instead, by their words — English only, and a
 * guess, which is why the model is asked.
 */
export const STEP_ACTIONS = [
  'prep', 'rinse', 'mix', 'season', 'boil', 'fry', 'bake', 'grill', 'blend', 'rest', 'serve',
  'shake', 'microwave', 'toast', 'airfry', 'chill', 'assemble', 'pour',
  // None of them: shown without a picture, because the wrong one is worse than none.
  'other',
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

/**
 * Kinds of step whose picture is still to be painted (design/cook/README.md).
 * Until it is in src/assets/cook/, a step of that kind is shown without one;
 * a test checks every other kind has its picture.
 */
export const AWAITING_PICTURES: readonly StepAction[] = [];

export interface StepDetail {
  action: StepAction;
  /** Minutes to set a timer for; absent when the step has nothing to wait for. */
  minutes?: number;
}

/**
 * Which way of labelling the steps they were labelled by. 2: each label is
 * where the food is (a sauce simmered in the frying pan is fry), told to the
 * model in any language. 3: and what goes into the blender is at the blender,
 * not on the chopping board. 4: more places to be (a shaker bottle, the
 * microwave, the toaster, the air fryer, the fridge, a board where a
 * sandwich is put together, a jug), and other where none of them is right.
 * Steps from before are relabelled when opened.
 */
export const STEP_LABELS = 4;

export const isStepAction = (value: unknown): value is StepAction => STEP_ACTIONS.includes(value as StepAction);

/** Checked in order: "bring to the boil, then simmer" is boiling, however it was chopped first. */
const WORDS: [StepAction, RegExp][] = [
  ['airfry', /\bair[- ]?fr(y|yer|ied)\b/i],
  ['microwave', /\b(microwave|microwaveable)\b/i],
  // The bottle, or shaking that is the whole point: "shake the pan now and then" is still frying.
  ['shake', /\bshaker\b|\bshake (?:it |them )?(?:well|hard|vigorously|until|for)\b/i],
  // The toaster, or bread in it: toasting the oats or the seeds is in a pan.
  ['toast', /\btoaster\b|\btoast (?:the |a |two |\d+ )?(?:slices?|bread|bagels?|muffins?|crumpets?|pittas?|teacakes?)\b/i],
  ['bake', /\b(bake|roast|oven)\b/i],
  ['grill', /\b(grill|broil|barbecue|bbq|griddle)\b/i],
  ['boil', /\b(boil|simmer|bubble|poach|steam|blanch|pasta|rice|noodles)\b/i],
  ['fry', /\b(fry|frying|sauté|saute|sear|brown|stir-fry|pan|skillet|wok)\b/i],
  ['blend', /\b(blend|blitz|puree|purée|smoothie|food processor)\b/i],
  ['rinse', /\b(rinse|drain|wash)\b/i],
  ['season', /\b(season|salt|pepper|sprinkle|spice)\b/i],
  ['chill', /\b(fridge|refrigerat\w*|chill|overnight)\b/i],
  ['mix', /\b(mix|stir|whisk|combine|toss|fold)\b/i],
  ['assemble', /\b(assemble|spread|layer|sandwich|wrap|fill)\b/i],
  ['rest', /\b(rest|cool|marinate|leave|set aside|soak)\b/i],
  ['serve', /\b(serve|plate|top with|enjoy|eat)\b/i],
  // A drink is not served on a plate.
  ['pour', /\bpour\b.*\b(glass|mug|cup|jug)\b|\bdrink\b/i],
  ['prep', /\b(chop|slice|dice|cut|peel|grate|mince|halve)\b/i],
];

/** A step's detail from its words, for steps written before the model labelled them. */
export function guessDetail(step: string): StepDetail {
  // Nothing it says gives it away: no picture, rather than the chopping board for a step that may be nowhere near one.
  const action = WORDS.find(([, re]) => re.test(step))?.[0] ?? 'other';
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
 * simmering step goes where its food is (whereItSimmers), and what it cooks
 * is remembered for the steps after.
 */
function followTheFood(steps: string[], details: StepDetail[], items: { name: string }[]): StepDetail[] {
  const where = new Map<string, StepAction>();
  let fried = false;
  const followed = details.map((detail, i) => {
    const using = usedIn(steps[i], items).map((item) => item.name);
    const into = intoWhat(steps[i]);
    const target = into ? usedIn(into, items).map((item) => where.get(item.name)) : [];
    const action = detail.action === 'boil' ? whereItSimmers(steps[i], using.map((name) => where.get(name)), target, fried) : detail.action;
    if (COOKING.has(action)) for (const name of using) where.set(name, action);
    if (action === 'fry') fried = true;
    return action === detail.action ? detail : { ...detail, action };
  });
  return aDrinkIsPoured(steps, intoTheShaker(steps, intoTheBlender(steps, followed)));
}

/**
 * Whole words in any script (`\b` knows only English letters), a pattern
 * allowing endings with \p{L}*. No lookbehind: iOS 15's Safari has none, and
 * one here would stop cook mode loading at all.
 */
const words = (...patterns: string[]) => new RegExp(`(?:^|[^\\p{L}\\p{M}])(?:${patterns.join('|')})(?![\\p{L}\\p{M}])`, 'iu');
/** Found anywhere: for scripts written without spaces, and words joined to what comes before (Arabic's al-). */
const within = (...fragments: string[]) => new RegExp(fragments.join('|'), 'u');
const either = (...res: RegExp[]) => ({ test: (text: string) => res.some((re) => re.test(text)) });

/**
 * The blender, by name, in every language the app speaks — the steps are
 * written in theirs. A plain "mixer" is left out in English, where it is the
 * one for cakes.
 */
const BLENDER = either(
  words(
    'blender\\p{L}*', 'food processors?', 'nutribullet', 'smoothie makers?', 'blend', 'blends', 'blending', 'blitz', 'puree', 'purée',
    'licuadora', 'batidora', 'procesador de alimentos', // es
    'mixeur', 'blendeur', 'robot culinaire', 'robot mixeur', // fr
    'standmixer', 'stabmixer', 'küchenmaschine', '(?:den|dem|im) mixer', // de
    'frullatore', 'robot da cucina', // it
    'liquidificadora?', 'processador de alimentos', 'robot de cozinha', // pt
    'keukenmachine', 'staafmixer', // nl
    'robot de bucătărie', 'mikser\\p{L}*', 'cumascóir', 'cymysgydd', 'prosesydd bwyd', 'máy xay', // ro, pl/tr, ga, cy, vi
    'μπλέντερ', 'μίξερ', // el
  ),
  within('خلاط', 'بلینڈر', 'ब्लेंडर', 'मिक्सर', 'ਬਲੈਂਡਰ', 'ਮਿਕਸਰ', 'ব্লেন্ডার', 'মিক্সার', '搅拌机', '料理机', '破壁机', 'ミキサー', 'ブレンダー', 'フードプロセッサー', '블렌더', '믹서'),
);
/** The blending itself, after which what is poured out is being served. */
const BLENDING = words(
  'blend', 'blends', 'blitz', 'blitzes', 'puree', 'purée', 'whizz',
  'tritur\\p{L}*', 'licú[ae]', 'licuar', // es, pt
  'mix(?:ez|e)', // fr
  'pürier\\p{L}*', 'mixen', // de, nl
  'frull(?:a|are|ate)', // it
  'pureer\\p{L}*', // nl
  'z?miksuj\\p{L}*', // pl
  'mixeaz[ăa]', // ro
);
/** Knife work: on the board, whatever it goes into next. Whole words, so the raspberries are not grated. */
const KNIFE = words(
  'chop', 'slice', 'dice', 'cut', 'peel', 'grate', 'mince', 'halve', 'core', 'hull', 'stone', 'pit',
  'pic(?:a|ar|ado|ada)', 'cort(?:a|ar|e|ado|ada)', 'pel(?:a|ar|ado|ada)', 'rall(?:a|ar)', 'trocea\\p{L}*', 'descasc\\p{L}*', 'fati\\p{L}*', // es, pt
  'coup(?:e|ez|er)', 'émin\\p{L}*', 'hach(?:e|ez|er)', 'épluch\\p{L}*', 'pel(?:ez|er)', 'râp(?:e|ez|er)', 'tranch(?:e|ez|er)', // fr
  'schneid\\p{L}*', 'hack\\p{L}*', 'schäl\\p{L}*', 'raspel\\p{L}*', 'würfel\\p{L}*', // de
  'tagli\\p{L}*', 'trit(?:a|are|ato|ata)', 'sbucci\\p{L}*', 'grattugi\\p{L}*', 'affett\\p{L}*', // it
  'snijd?\\p{L}*', 'schil\\p{L}*', 'rasp(?:en)?', 'hak(?:ken)?', // nl
  'pokr[óo]j\\p{L}*', 'posiekaj', 'obierz', 'zetrzyj', // pl
  'tai(?:e|ați)', 'toac[ăa]', 'cur[ăa]ț[ăa]', 'rade', // ro
  'doğra\\p{L}*', 'kes(?:in|ip|erek)?', 'soy(?:un|up)', 'rendele\\p{L}*', // tr
);
/** A step putting something into something. */
const PUTTING = words(
  'add', 'adding', 'put', 'place', 'tip', 'pour', 'spoon', 'scoop', 'drop', 'throw', 'crumble', 'squeeze',
  'añad\\p{L}*', 'agreg\\p{L}*', 'viert\\p{L}*', 'verter', 'ech(?:a|ar)', 'pon', 'ponga', 'incorpor\\p{L}*', 'mete', // es
  'ajout\\p{L}*', 'vers(?:e|ez|er)', 'mett(?:e|ez|re)', 'plac(?:e|ez|er)', // fr
  'gib', 'geben', 'füg\\p{L}*', 'hinzu\\p{L}*', 'gieß\\p{L}*', 'giess\\p{L}*', // de
  'aggiung\\p{L}*', 'vers(?:a|are|ate)', 'mett(?:i|ete|ere)', 'unisc\\p{L}*', // it
  'adicion\\p{L}*', 'junt(?:e|a|ar)', 'deit(?:e|a|ar)', 'coloqu\\p{L}*', 'acrescent\\p{L}*', // pt
  'voeg\\p{L}*', 'doe', 'schenk\\p{L}*', 'giet', // nl
  'dodaj\\p{L}*', 'wlej', 'wsyp', 'włóż', // pl
  'adaug\\p{L}*', 'pune\\p{L}*', 'toarn\\p{L}*', // ro
  'ekle\\p{L}*', 'koy\\p{L}*', 'dök\\p{L}*', // tr
);
/** What a step at the blender can have been labelled instead: the board, the bowl, the seasoning, or nowhere in particular. */
const MOVABLE = new Set<StepAction>(['prep', 'mix', 'season', 'other']);

/**
 * A smoothie is a row of things going into the blender, and the board is
 * no picture for "add the berries". So a step that names the blender is at
 * it, and so is every step after it until it is switched on; and anything
 * added just before a step at the blender is going into it. Chopping stays
 * on the board, and pouring out once it is blended is serving.
 *
 * The blender is known by name in every language the app speaks, and the
 * blending by the model's own label for it, so a smoothie in Japanese
 * follows its food too. Adding and chopping are known by their words in
 * English and the main European languages; elsewhere, what goes in before
 * the blender is named is left to the model, which relabels old steps in
 * any language whenever it can be asked.
 */
function intoTheBlender(steps: string[], details: StepDetail[]): StepDetail[] {
  const given = details.map((detail) => detail.action);
  const actions = [...given];
  const named = steps.map((step) => BLENDER.test(step));
  const blending = steps.map((step, i) => BLENDING.test(step) || (given[i] === 'blend' && !named[i]));
  const movable = (i: number) => MOVABLE.has(given[i]) && !(KNIFE.test(steps[i]) && !named[i]);
  let open = false;
  steps.forEach((_, i) => {
    if ((named[i] || open) && movable(i)) actions[i] = 'blend';
    if (named[i] || blending[i]) open = !blending[i];
  });
  for (let i = steps.length - 2; i >= 0; i--) {
    if (actions[i + 1] === 'blend' && PUTTING.test(steps[i]) && movable(i)) actions[i] = 'blend';
  }
  return details.map((detail, i) => (actions[i] === detail.action ? detail : { ...detail, action: actions[i] }));
}

/** A shaker bottle, as named in most of the languages the app speaks: the English word, borrowed. */
const SHAKER = words('shaker\\p{L}*', 'coctelera', 'shakeuse', 'シェイカー', 'シェーカー', '쉐이커', '摇摇杯', 'شيكر');

/** The shaking itself, after which it is drunk. */
const SHAKING = words(
  'shake', 'shakes', 'shaking', 'shook',
  'agit(?:a|e|ez|ar|er|are)', 'sacud\\p{L}*', // es, fr, it, pt
  'secou(?:e|ez|er)', // fr
  'schüttel\\p{L}*', 'schud\\p{L}*', // de, nl
  'scuoti\\p{L}*', // it
  'wstrząśnij', 'potrząśnij', // pl
);

/**
 * Whatever goes into the shaker bottle is at the shaker, not in a mixing
 * bowl: the step that names it, and every one after until it is shaken —
 * "seal and shake hard" does not say what it is shaking.
 */
function intoTheShaker(steps: string[], details: StepDetail[]): StepDetail[] {
  let open = false;
  return details.map((detail, i) => {
    const named = SHAKER.test(steps[i]);
    const at = (named || open) && MOVABLE.has(detail.action);
    if (named) open = true;
    if (SHAKING.test(steps[i])) open = false;
    return at ? { ...detail, action: 'shake' } : detail;
  });
}

/** Drinking it, in the main languages the app speaks. */
const DRINKING = words(
  'drink', 'drinks', 'sip', 'bebe', 'bébalo', 'bébela', 'beber', 'bois', 'buvez', 'boire', 'trink\\p{L}*', 'bevi', 'bevete', 'bere', 'drinken', 'drink het', 'wypij', 'pij', 'bea', 'beți', 'iç', 'için',
);

/** Served as a drink is not served on a plate: the plate is for food. */
function aDrinkIsPoured(steps: string[], details: StepDetail[]): StepDetail[] {
  return details.map((detail, i) => (detail.action === 'serve' && DRINKING.test(steps[i]) ? { ...detail, action: 'pour' } : detail));
}

/** Words that put a step in a saucepan of water, whatever else it says. */
const POT = /\b(saucepan|pot|boiling water|pan of (?:salted )?water|kettle|steamer)\b/i;
/** Words that put it in the frying pan. */
const PAN = /\b(frying pan|skillet|wok|sauce)\b/i;
/** Foods that go into boiling water, not into a sauce. */
const BOILED = /\b(pasta|spaghetti|penne|fusilli|macaroni|linguine|tagliatelle|rigatoni|noodles?|rice|couscous|quinoa|potato(?:es)?|eggs?|dumplings?|gnocchi)\b/i;
/** A step putting something into what is already cooking. */
const ADDING = /\b(add|adding|stir in|stir through|pour in|pour over|tip in|mix in)\b/i;

/** What a step puts things into: the words after "to the", "into the", "in with the". */
function intoWhat(step: string): string | undefined {
  const m = step.match(/\b(?:to|into|in with|over)\s+(?:the|your)\s+(.+)$/i);
  return m?.[1];
}

/**
 * Where a step labelled boil happens: a saucepan unless its food is in the
 * frying pan. Said outright, that decides it. Otherwise the food it names
 * that is already cooking does: what it goes into first ("add the lentils to
 * the onion"), then the rest, in the pan and not the pot, the pan. And
 * something new added and simmered once there is a frying pan going ("add the
 * tomatoes and simmer") joins the pan, unless it is the pasta or the rice.
 */
function whereItSimmers(step: string, already: (StepAction | undefined)[], into: (StepAction | undefined)[], fried: boolean): StepAction {
  if (POT.test(step)) return 'boil';
  if (PAN.test(step)) return fried || already.includes('fry') ? 'fry' : 'boil';
  if (into.includes('fry') !== into.includes('boil')) return into.includes('fry') ? 'fry' : 'boil';
  if (already.includes('boil')) return 'boil';
  if (already.includes('fry')) return 'fry';
  if (fried && ADDING.test(step) && !BOILED.test(step)) return 'fry';
  return 'boil';
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
