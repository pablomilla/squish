/**
 * Squish accuracy + cost benchmark.
 *
 *   npm run bench                    every model in the default list, one run each
 *   npm run bench -- --models claude-sonnet-5,claude-haiku-4-5
 *   npm run bench -- --runs 3        repeat each photo, to see run-to-run spread
 *   npm run bench -- --sub 6.99      margin maths against your subscription price
 *
 * Reads bench/manifest.json — your photos and what is actually in them — and
 * answers two questions: how close does each model get, and what does it cost
 * to run a user for a month. See bench/README.md for how to build the set.
 *
 * Every run spends real money. It prints the bill before it starts.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analysePhotoDetailed, hasCredentials, type Crockery, type ModelUsage } from '../server/claude';
import type { MealSlot } from '../src/types';

const BENCH_DIR = resolve(process.cwd(), 'bench');
const DEFAULT_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

/** Store cut on subscriptions: 15% on the small-business rate, 30% standard. */
const STORE_CUT = { small: 0.15, standard: 0.3 };
/**
 * UK prices on the stores include VAT, and the store takes its cut of what is
 * left — so £6.99 is £5.83 before anybody's share, not £6.99.
 */
const UK_VAT = 0.2;

const ESC = String.fromCharCode(27);
const paint = (code: string) => (text: string) => `${ESC}[${code}m${text}${ESC}[0m`;
const bold = paint('1');
const dim = paint('2');
const red = paint('31');

export interface MealFixture {
  file: string;
  name: string;
  /** What is genuinely in the meal — from a label, or weighed ingredients. */
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /**
   * What the food on the plate weighed, in grams. Optional, and the only
   * direct measure of portion accuracy there is: calories can come out right
   * off a portion guessed wrong, when one error cancels another.
   */
  grams?: number;
  slot?: MealSlot;
  source?: string;
}

export interface Attempt {
  model: string;
  meal: string;
  run: number;
  /** Which arm of the comparison this was — see `VARIANTS`. */
  variant: string;
  ok: boolean;
  error?: string;
  predicted?: { calories: number; protein: number; carbs: number; fat: number };
  /** Total grams across the items, for the portion measure. */
  predictedGrams?: number;
  items?: string[];
  usage?: ModelUsage;
}

/** One arm of a run: a label and the crockery the model is told about. */
interface Variant {
  name: string;
  crockery?: Crockery;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const MEDIA: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const usd = (value: number, dp = 4) => `$${value.toFixed(dp)}`;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Absolute percentage error, guarding the divide when truth is zero. */
export function ape(actual: number, predicted: number): number {
  if (actual === 0) return predicted === 0 ? 0 : 1;
  return Math.abs(predicted - actual) / actual;
}

export interface ModelScore {
  model: string;
  variant: string;
  attempts: number;
  failures: number;
  calorieMape: number;
  /** Share of meals whose calorie estimate lands within 20% — the usable bar. */
  within20: number;
  proteinMae: number;
  carbsMae: number;
  fatMae: number;
  costPerAnalysis: number;
  medianLatencyMs: number;
  spread: number;
  /** Portion error, where the manifest says what the food weighed. */
  gramsMape: number;
  gramsWithin20: number;
  gramsMeals: number;
}

/** Score one model's attempts against the fixtures. */
export function scoreModel(model: string, attempts: Attempt[], fixtures: MealFixture[], variant = 'default'): ModelScore {
  const byName = new Map(fixtures.map((f) => [f.name, f]));
  const done = attempts.filter((a) => a.ok && a.predicted);
  const calorieErrors: number[] = [];
  const perMeal = new Map<string, number[]>();
  const proteinErrors: number[] = [];
  const carbsErrors: number[] = [];
  const fatErrors: number[] = [];
  const gramsErrors: number[] = [];

  for (const attempt of done) {
    const truth = byName.get(attempt.meal);
    if (!truth || !attempt.predicted) continue;
    const error = ape(truth.calories, attempt.predicted.calories);
    calorieErrors.push(error);
    perMeal.set(attempt.meal, [...(perMeal.get(attempt.meal) ?? []), attempt.predicted.calories]);
    proteinErrors.push(Math.abs(attempt.predicted.protein - truth.protein));
    carbsErrors.push(Math.abs(attempt.predicted.carbs - truth.carbs));
    fatErrors.push(Math.abs(attempt.predicted.fat - truth.fat));
    // Only the meals that were actually weighed, so an unweighed set simply
    // reports nothing here rather than a number made of absences.
    if (truth.grams && attempt.predictedGrams) gramsErrors.push(ape(truth.grams, attempt.predictedGrams));
  }

  // Run-to-run spread on the same photo: max minus min, as a share of the mean.
  const spreads = [...perMeal.values()]
    .filter((values) => values.length > 1)
    .map((values) => (Math.max(...values) - Math.min(...values)) / (mean(values) || 1));

  const costs = done.map((a) => a.usage?.costUsd ?? 0).filter((c) => c > 0);

  return {
    model,
    variant,
    attempts: attempts.length,
    failures: attempts.filter((a) => !a.ok).length,
    calorieMape: mean(calorieErrors),
    within20: calorieErrors.length ? calorieErrors.filter((e) => e <= 0.2).length / calorieErrors.length : 0,
    proteinMae: mean(proteinErrors),
    carbsMae: mean(carbsErrors),
    fatMae: mean(fatErrors),
    costPerAnalysis: mean(costs),
    medianLatencyMs: median(done.map((a) => a.usage?.latencyMs ?? 0)),
    spread: mean(spreads),
    gramsMape: mean(gramsErrors),
    gramsWithin20: gramsErrors.length ? gramsErrors.filter((e) => e <= 0.2).length / gramsErrors.length : 0,
    gramsMeals: gramsErrors.length,
  };
}

export interface PlateVerdict {
  model: string;
  /** Portion error without the plate size, and with it. */
  gramsBefore: number;
  gramsAfter: number;
  caloriesBefore: number;
  caloriesAfter: number;
  /** Meals carrying a weight, which is what the portion figures rest on. */
  weighedMeals: number;
  verdict: string;
}

/**
 * Did telling Squish the plate size help?
 *
 * Portion error is the honest measure and calorie error is the one people
 * feel, so both are reported. The wording is deliberately careful: a handful
 * of meals cannot settle this, and a verdict that sounds certain off six
 * photographs would be worse than no verdict at all.
 */
export function plateVerdict(before: ModelScore, after: ModelScore): PlateVerdict {
  const usePortion = before.gramsMeals > 0 && after.gramsMeals > 0;
  const beforeError = usePortion ? before.gramsMape : before.calorieMape;
  const afterError = usePortion ? after.gramsMape : after.calorieMape;
  const change = beforeError - afterError;
  const relative = beforeError > 0 ? change / beforeError : 0;
  const measure = usePortion ? 'portion' : 'calorie';

  let verdict: string;
  if (before.gramsMeals + after.gramsMeals === 0 && !usePortion) {
    verdict = `No weighed meals, so this is ${measure} error only — weigh some and run it again.`;
  }
  if (Math.abs(relative) < 0.05) {
    verdict = `No real difference: ${measure} error moved by ${pct(Math.abs(relative))}, which is noise.`;
  } else if (relative > 0) {
    verdict = `Better with the plate size: ${measure} error down ${pct(relative)}.`;
  } else {
    verdict = `Worse with the plate size: ${measure} error up ${pct(-relative)}.`;
  }

  const meals = Math.min(before.attempts, after.attempts);
  if (meals < 20) {
    verdict += ` Off ${meals} analys${meals === 1 ? 'is' : 'es'}, treat that as a hint rather than a result.`;
  }

  return {
    model: before.model,
    gramsBefore: before.gramsMape,
    gramsAfter: after.gramsMape,
    caloriesBefore: before.calorieMape,
    caloriesAfter: after.calorieMape,
    weighedMeals: Math.min(before.gramsMeals, after.gramsMeals),
    verdict,
  };
}

export interface Economics {
  monthlyApiCost: number;
  netAtSmallBusiness: number;
  netAtStandard: number;
}

/** What one active user costs and earns per month. */
export function economics(costPerAnalysis: number, mealsPerDay: number, subscription: number): Economics {
  const monthlyApiCost = costPerAnalysis * mealsPerDay * 30;
  return {
    monthlyApiCost,
    netAtSmallBusiness: (subscription / (1 + UK_VAT)) * (1 - STORE_CUT.small) - monthlyApiCost,
    netAtStandard: (subscription / (1 + UK_VAT)) * (1 - STORE_CUT.standard) - monthlyApiCost,
  };
}

async function loadFixtures(): Promise<MealFixture[]> {
  const path = resolve(BENCH_DIR, 'manifest.json');
  try {
    await access(path);
  } catch {
    throw new Error(
      'No bench/manifest.json yet. Copy bench/manifest.example.json to bench/manifest.json, ' +
        'put your photos in bench/photos/, and read bench/README.md for how to pick them.',
    );
  }
  const fixtures = JSON.parse(await readFile(path, 'utf8')) as MealFixture[];
  if (!Array.isArray(fixtures) || !fixtures.length) throw new Error('bench/manifest.json has no meals in it.');

  for (const fixture of fixtures) {
    const photo = resolve(BENCH_DIR, 'photos', fixture.file);
    try {
      await access(photo);
    } catch {
      throw new Error(`Missing photo for "${fixture.name}": expected bench/photos/${fixture.file}`);
    }
  }
  return fixtures;
}

async function runOne(fixture: MealFixture, model: string, run: number, variant: Variant): Promise<Attempt> {
  const path = resolve(BENCH_DIR, 'photos', fixture.file);
  const base64 = (await readFile(path)).toString('base64');
  const mediaType = MEDIA[extname(fixture.file).toLowerCase()] ?? 'image/jpeg';

  try {
    const { analysis, usage } = await analysePhotoDetailed(
      base64,
      mediaType,
      fixture.slot,
      undefined,
      model,
      variant.crockery,
    );
    return {
      model,
      meal: fixture.name,
      run,
      variant: variant.name,
      ok: true,
      predicted: {
        calories: analysis.nutrients.calories,
        protein: analysis.nutrients.protein,
        carbs: analysis.nutrients.carbs,
        fat: analysis.nutrients.fat,
      },
      // What the model thinks was on the plate, which is the portion call
      // laid bare — calories can land right off a weight guessed wrong.
      predictedGrams: analysis.items.reduce((sum, item) => sum + (item.grams ?? 0), 0) || undefined,
      items: analysis.items.map((item) => `${item.name} (${item.portion})`),
      usage,
    };
  } catch (error) {
    return {
      model,
      meal: fixture.name,
      run,
      variant: variant.name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function markdownReport(scores: ModelScore[], fixtures: MealFixture[], attempts: Attempt[], subscription: number): string {
  const lines: string[] = [];
  lines.push('# Squish model benchmark', '');
  lines.push(`Run ${new Date().toISOString()} · ${fixtures.length} meals · ${attempts.length} analyses`, '');

  const arms = [...new Set(scores.map((s) => s.variant))];
  if (arms.length > 1) {
    lines.push('## Does telling Squish your plate size help?', '');
    lines.push('| Model | Portion error, no plate | …with plate | Calorie error, no plate | …with plate | Weighed meals |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const model of [...new Set(scores.map((s) => s.model))]) {
      const before = scores.find((s) => s.model === model && s.variant === arms[0]);
      const after = scores.find((s) => s.model === model && s.variant === arms[1]);
      if (!before || !after) continue;
      const v = plateVerdict(before, after);
      lines.push(
        `| ${model} | ${v.weighedMeals ? pct(v.gramsBefore) : '—'} | ${v.weighedMeals ? pct(v.gramsAfter) : '—'} | ` +
          `${pct(v.caloriesBefore)} | ${pct(v.caloriesAfter)} | ${v.weighedMeals} |`,
      );
    }
    lines.push('');
    for (const model of [...new Set(scores.map((s) => s.model))]) {
      const before = scores.find((s) => s.model === model && s.variant === arms[0]);
      const after = scores.find((s) => s.model === model && s.variant === arms[1]);
      if (before && after) lines.push(`- **${model}** — ${plateVerdict(before, after).verdict}`);
    }
    lines.push('');
  }

  lines.push('## Accuracy and cost', '');
  const armColumn = arms.length > 1 ? ' Arm |' : '';
  const armDash = arms.length > 1 ? ' --- |' : '';
  lines.push(`| Model |${armColumn} Calorie error | Within 20% | Portion error | Protein ±g | Carbs ±g | Fat ±g | Cost/photo | Median latency | Failed |`);
  lines.push(`| --- |${armDash} --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const s of scores) {
    lines.push(
      `| ${s.model} |${arms.length > 1 ? ` ${s.variant} |` : ''} ${pct(s.calorieMape)} | ${pct(s.within20)} | ` +
        `${s.gramsMeals ? pct(s.gramsMape) : '—'} | ${s.proteinMae.toFixed(1)} | ` +
        `${s.carbsMae.toFixed(1)} | ${s.fatMae.toFixed(1)} | ${usd(s.costPerAnalysis)} | ` +
        `${(s.medianLatencyMs / 1000).toFixed(1)}s | ${s.failures} |`,
    );
  }
  lines.push('');
  lines.push('*Calorie error is the mean absolute percentage error against your figures. "Within 20%" is the');
  lines.push('share of meals close enough to be worth logging — the number that decides whether people trust it.');
  lines.push('Portion error is the same measure against what the food weighed, over the meals you weighed. It is');
  lines.push('the honest test of portion estimation: calories can land right off a weight guessed wrong, when one');
  lines.push('error cancels another.*', '');

  lines.push(`## What a user costs, at $${subscription.toFixed(2)}/month`, '');
  lines.push('| Model | 2 meals/day | 3 meals/day | 5 meals/day | Net at 15% store cut (3/day) | Net at 30% (3/day) |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of scores.filter((score) => score.variant === arms[0])) {
    const three = economics(s.costPerAnalysis, 3, subscription);
    lines.push(
      `| ${s.model} | ${usd(economics(s.costPerAnalysis, 2, subscription).monthlyApiCost, 2)} | ` +
        `${usd(three.monthlyApiCost, 2)} | ${usd(economics(s.costPerAnalysis, 5, subscription).monthlyApiCost, 2)} | ` +
        `${usd(three.netAtSmallBusiness, 2)} | ${usd(three.netAtStandard, 2)} |`,
    );
  }
  lines.push('');
  lines.push('*Net is per subscriber per month, before hosting, support, and the people who subscribe and never log in.*', '');

  lines.push('## Per meal', '');
  for (const fixture of fixtures) {
    lines.push(`### ${fixture.name}`, '');
    lines.push(`Actual: **${fixture.calories} kcal**, P ${fixture.protein} / C ${fixture.carbs} / F ${fixture.fat}` +
      (fixture.grams ? `, ${fixture.grams} g on the plate` : '') +
      (fixture.source ? ` · ${fixture.source}` : ''), '');
    lines.push(`| Model |${armColumn} Calories | Error | Grams | Saw |`);
    lines.push(`| --- |${armDash} --- | --- | --- | --- |`);
    for (const attempt of attempts.filter((a) => a.meal === fixture.name)) {
      const arm = arms.length > 1 ? ` ${attempt.variant} |` : '';
      if (!attempt.ok || !attempt.predicted) {
        lines.push(`| ${attempt.model} |${arm} — | failed | — | ${attempt.error ?? ''} |`);
        continue;
      }
      const grams = attempt.predictedGrams
        ? `${attempt.predictedGrams}${fixture.grams ? ` (${pct(ape(fixture.grams, attempt.predictedGrams))})` : ''}`
        : '—';
      lines.push(
        `| ${attempt.model} |${arm} ${attempt.predicted.calories} | ${pct(ape(fixture.calories, attempt.predicted.calories))} | ` +
          `${grams} | ${(attempt.items ?? []).join(', ')} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  console.log(`\n${bold('🫧  Squish · model benchmark')}\n`);

  if (!hasCredentials()) {
    console.log(red('  No Anthropic credentials — this benchmark calls the real API.'));
    console.log('  Run npm run setup:ai first.\n');
    process.exitCode = 1;
    return;
  }

  const models = (arg('models') ?? DEFAULT_MODELS.join(',')).split(',').map((m) => m.trim()).filter(Boolean);
  const runs = Math.max(1, Number(arg('runs') ?? 1));
  const subscription = Number(arg('sub') ?? 6.99);

  const plateCm = Number(arg('plate') ?? 0) || undefined;
  const bowlMl = Number(arg('bowl') ?? 0) || undefined;
  const crockery: Crockery | undefined = plateCm || bowlMl ? { plateCm, bowlMl } : undefined;

  /*
   * Two arms rather than one, when asked: the same photo analysed with the
   * plate size and without it. That is the only way to know whether telling
   * Squish the size of your plate does anything, and the answer is not
   * knowable from a single run — a model that is simply good would look the
   * same either way.
   */
  const comparing = process.argv.includes('--compare-plate');
  if (comparing && !crockery) {
    console.log(red('  --compare-plate needs a plate to compare against.'));
    console.log('  Measure a dinner plate across and pass it: npm run bench -- --compare-plate --plate 27\n');
    process.exitCode = 1;
    return;
  }

  const variants: Variant[] = comparing
    ? [{ name: 'no plate size' }, { name: 'with plate size', crockery }]
    : [{ name: crockery ? 'with plate size' : 'default', crockery }];

  const fixtures = await loadFixtures();
  const total = fixtures.length * models.length * runs * variants.length;

  const weighed = fixtures.filter((f) => f.grams).length;

  console.log(
    `  ${fixtures.length} meals × ${models.length} models × ${runs} run${runs === 1 ? '' : 's'}` +
      (variants.length > 1 ? ` × ${variants.length} arms` : '') +
      ` = ${bold(String(total))} analyses`,
  );
  console.log(dim(`  Models: ${models.join(', ')}`));
  if (comparing) console.log(dim(`  Comparing: ${variants.map((v) => v.name).join(' vs ')}`));
  console.log(
    weighed
      ? dim(`  ${weighed} of ${fixtures.length} meals carry a weight, so portion error is measurable.`)
      : dim('  No meal in the manifest carries a "grams" figure, so portion error cannot be measured.'),
  );
  console.log(dim('  Rough cost: a few pence per analysis on Opus, less on the others.\n'));

  if (process.stdin.isTTY && !process.argv.includes('--yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('  This spends real money. Go ahead? [y/N] ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log(dim('\n  Stopped. Nothing was called.\n'));
      return;
    }
    console.log('');
  }

  const attempts: Attempt[] = [];
  let done = 0;
  for (const model of models) {
    for (const variant of variants) {
      for (let run = 1; run <= runs; run += 1) {
        for (const fixture of fixtures) {
          const attempt = await runOne(fixture, model, run, variant);
          attempts.push(attempt);
          done += 1;
          const status = attempt.ok
            ? `${attempt.predicted?.calories} kcal vs ${fixture.calories} (${pct(ape(fixture.calories, attempt.predicted?.calories ?? 0))} off)`
            : red(`failed: ${attempt.error}`);
          const arm = variants.length > 1 ? `${variant.name.padEnd(16)} ` : '';
          console.log(`  [${String(done).padStart(3)}/${total}] ${model.padEnd(18)} ${arm}${fixture.name.padEnd(24)} ${status}`);
        }
      }
    }
  }

  const scores = models.flatMap((model) =>
    variants.map((variant) =>
      scoreModel(
        model,
        attempts.filter((a) => a.model === model && a.variant === variant.name),
        fixtures,
        variant.name,
      ),
    ),
  );

  console.log(`\n${bold('  Results')}\n`);
  console.table(
    scores.map((s) => ({
      model: s.model,
      ...(variants.length > 1 ? { arm: s.variant } : {}),
      'calorie error': pct(s.calorieMape),
      'within 20%': pct(s.within20),
      'portion error': s.gramsMeals ? pct(s.gramsMape) : '—',
      'protein ±g': s.proteinMae.toFixed(1),
      'cost/photo': usd(s.costPerAnalysis),
      'median latency': `${(s.medianLatencyMs / 1000).toFixed(1)}s`,
      failed: s.failures,
      ...(runs > 1 ? { 'run spread': pct(s.spread) } : {}),
    })),
  );

  if (comparing) {
    console.log(`\n${bold('  Does the plate size help?')}\n`);
    for (const model of models) {
      const before = scores.find((sc) => sc.model === model && sc.variant === variants[0].name);
      const after = scores.find((sc) => sc.model === model && sc.variant === variants[1].name);
      if (before && after) console.log(`  ${model.padEnd(18)} ${plateVerdict(before, after).verdict}`);
    }
  }

  console.log(`\n${bold(`  Per subscriber per month, at $${subscription.toFixed(2)}`)}\n`);
  console.table(
    scores.map((s) => {
      const three = economics(s.costPerAnalysis, 3, subscription);
      return {
        model: s.model,
        'API cost (3 meals/day)': usd(three.monthlyApiCost, 2),
        'net at 15% cut': usd(three.netAtSmallBusiness, 2),
        'net at 30% cut': usd(three.netAtStandard, 2),
      };
    }),
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(resolve(BENCH_DIR, `results-${stamp}.json`), JSON.stringify({ scores, attempts, fixtures }, null, 2));
  await writeFile(resolve(BENCH_DIR, 'report.md'), markdownReport(scores, fixtures, attempts, subscription));

  const spent = attempts.reduce((sum, a) => sum + (a.usage?.costUsd ?? 0), 0);
  console.log(`\n  Spent about ${bold(usd(spent, 2))} on this run.`);
  console.log(`  Written: ${bold('bench/report.md')} ${dim(`and results-${stamp}.json`)}\n`);
}

const runDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (runDirectly) {
  main().catch((error: unknown) => {
    console.log(red(`\n  ${error instanceof Error ? error.message : String(error)}\n`));
    process.exitCode = 1;
  });
}
