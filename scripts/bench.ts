/**
 * Squish accuracy + cost benchmark.
 *
 *   npm run bench                    every model in the default list, one run each
 *   npm run bench -- --models claude-sonnet-5,claude-haiku-4-5
 *   npm run bench -- --runs 3        repeat each photo, to see run-to-run spread
 *   npm run bench -- --sub 4.99      margin maths against your subscription price
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
import { analysePhotoDetailed, hasCredentials, type ModelUsage } from '../server/claude';
import type { MealSlot } from '../src/types';

const BENCH_DIR = resolve(process.cwd(), 'bench');
const DEFAULT_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

/** Store cut on subscriptions: 15% on the small-business rate, 30% standard. */
const STORE_CUT = { small: 0.15, standard: 0.3 };

const ESC = String.fromCharCode(27);
const paint = (code: string) => (text: string) => `${ESC}[${code}m${text}${ESC}[0m`;
const bold = paint('1');
const dim = paint('2');
const red = paint('31');

interface MealFixture {
  file: string;
  name: string;
  /** What is genuinely in the meal — from a label, or weighed ingredients. */
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  slot?: MealSlot;
  source?: string;
}

interface Attempt {
  model: string;
  meal: string;
  run: number;
  ok: boolean;
  error?: string;
  predicted?: { calories: number; protein: number; carbs: number; fat: number };
  items?: string[];
  usage?: ModelUsage;
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
}

/** Score one model's attempts against the fixtures. */
export function scoreModel(model: string, attempts: Attempt[], fixtures: MealFixture[]): ModelScore {
  const byName = new Map(fixtures.map((f) => [f.name, f]));
  const done = attempts.filter((a) => a.ok && a.predicted);
  const calorieErrors: number[] = [];
  const perMeal = new Map<string, number[]>();
  const proteinErrors: number[] = [];
  const carbsErrors: number[] = [];
  const fatErrors: number[] = [];

  for (const attempt of done) {
    const truth = byName.get(attempt.meal);
    if (!truth || !attempt.predicted) continue;
    const error = ape(truth.calories, attempt.predicted.calories);
    calorieErrors.push(error);
    perMeal.set(attempt.meal, [...(perMeal.get(attempt.meal) ?? []), attempt.predicted.calories]);
    proteinErrors.push(Math.abs(attempt.predicted.protein - truth.protein));
    carbsErrors.push(Math.abs(attempt.predicted.carbs - truth.carbs));
    fatErrors.push(Math.abs(attempt.predicted.fat - truth.fat));
  }

  // Run-to-run spread on the same photo: max minus min, as a share of the mean.
  const spreads = [...perMeal.values()]
    .filter((values) => values.length > 1)
    .map((values) => (Math.max(...values) - Math.min(...values)) / (mean(values) || 1));

  const costs = done.map((a) => a.usage?.costUsd ?? 0).filter((c) => c > 0);

  return {
    model,
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
    netAtSmallBusiness: subscription * (1 - STORE_CUT.small) - monthlyApiCost,
    netAtStandard: subscription * (1 - STORE_CUT.standard) - monthlyApiCost,
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

async function runOne(fixture: MealFixture, model: string, run: number): Promise<Attempt> {
  const path = resolve(BENCH_DIR, 'photos', fixture.file);
  const base64 = (await readFile(path)).toString('base64');
  const mediaType = MEDIA[extname(fixture.file).toLowerCase()] ?? 'image/jpeg';

  try {
    const { analysis, usage } = await analysePhotoDetailed(base64, mediaType, fixture.slot, undefined, model);
    return {
      model,
      meal: fixture.name,
      run,
      ok: true,
      predicted: {
        calories: analysis.nutrients.calories,
        protein: analysis.nutrients.protein,
        carbs: analysis.nutrients.carbs,
        fat: analysis.nutrients.fat,
      },
      items: analysis.items.map((item) => `${item.name} (${item.portion})`),
      usage,
    };
  } catch (error) {
    return { model, meal: fixture.name, run, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function markdownReport(scores: ModelScore[], fixtures: MealFixture[], attempts: Attempt[], subscription: number): string {
  const lines: string[] = [];
  lines.push('# Squish model benchmark', '');
  lines.push(`Run ${new Date().toISOString()} · ${fixtures.length} meals · ${attempts.length} analyses`, '');

  lines.push('## Accuracy and cost', '');
  lines.push('| Model | Calorie error | Within 20% | Protein ±g | Carbs ±g | Fat ±g | Cost/photo | Median latency | Failed |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of scores) {
    lines.push(
      `| ${s.model} | ${pct(s.calorieMape)} | ${pct(s.within20)} | ${s.proteinMae.toFixed(1)} | ` +
        `${s.carbsMae.toFixed(1)} | ${s.fatMae.toFixed(1)} | ${usd(s.costPerAnalysis)} | ` +
        `${(s.medianLatencyMs / 1000).toFixed(1)}s | ${s.failures} |`,
    );
  }
  lines.push('');
  lines.push('*Calorie error is the mean absolute percentage error against your figures. "Within 20%" is the');
  lines.push('share of meals close enough to be worth logging — the number that decides whether people trust it.*', '');

  lines.push(`## What a user costs, at $${subscription.toFixed(2)}/month`, '');
  lines.push('| Model | 2 meals/day | 3 meals/day | 5 meals/day | Net at 15% store cut (3/day) | Net at 30% (3/day) |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of scores) {
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
      (fixture.source ? ` · ${fixture.source}` : ''), '');
    lines.push('| Model | Calories | Error | Saw |');
    lines.push('| --- | --- | --- | --- |');
    for (const attempt of attempts.filter((a) => a.meal === fixture.name)) {
      if (!attempt.ok || !attempt.predicted) {
        lines.push(`| ${attempt.model} | — | failed | ${attempt.error ?? ''} |`);
        continue;
      }
      lines.push(
        `| ${attempt.model} | ${attempt.predicted.calories} | ${pct(ape(fixture.calories, attempt.predicted.calories))} | ` +
          `${(attempt.items ?? []).join(', ')} |`,
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
  const subscription = Number(arg('sub') ?? 4.99);

  const fixtures = await loadFixtures();
  const total = fixtures.length * models.length * runs;

  console.log(`  ${fixtures.length} meals × ${models.length} models × ${runs} run${runs === 1 ? '' : 's'} = ${bold(String(total))} analyses`);
  console.log(dim(`  Models: ${models.join(', ')}`));
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
    for (let run = 1; run <= runs; run += 1) {
      for (const fixture of fixtures) {
        const attempt = await runOne(fixture, model, run);
        attempts.push(attempt);
        done += 1;
        const status = attempt.ok
          ? `${attempt.predicted?.calories} kcal vs ${fixture.calories} (${pct(ape(fixture.calories, attempt.predicted?.calories ?? 0))} off)`
          : red(`failed: ${attempt.error}`);
        console.log(`  [${String(done).padStart(3)}/${total}] ${model.padEnd(18)} ${fixture.name.padEnd(24)} ${status}`);
      }
    }
  }

  const scores = models.map((model) => scoreModel(model, attempts.filter((a) => a.model === model), fixtures));

  console.log(`\n${bold('  Results')}\n`);
  console.table(
    scores.map((s) => ({
      model: s.model,
      'calorie error': pct(s.calorieMape),
      'within 20%': pct(s.within20),
      'protein ±g': s.proteinMae.toFixed(1),
      'cost/photo': usd(s.costPerAnalysis),
      'median latency': `${(s.medianLatencyMs / 1000).toFixed(1)}s`,
      failed: s.failures,
      ...(runs > 1 ? { 'run spread': pct(s.spread) } : {}),
    })),
  );

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
