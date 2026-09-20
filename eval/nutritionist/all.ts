/**
 * The whole thing, in one command.
 *
 *   npm run eval
 *
 * Runs the three configurations being compared, builds the report, and says
 * where it is. Safe to stop and start again — each run picks up where it left
 * off, so an interrupted pass costs the case it was on and nothing else.
 *
 * It exists because the alternative was four commands, one of which needed a
 * path into a directory that is not in this repository. A benchmark nobody can
 * start is a benchmark nobody runs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasCredentials, credentialSource } from '../../server/claude';

const FLOW = '.claude/hillclimb/nutritionist';

/** What is being compared, and why each one is in the list. */
const VARIANTS = [
  { id: 'baseline', why: 'Opus 5 at medium effort — exactly what ships today', args: [] },
  {
    id: 'v1',
    why: 'Opus 5 at low effort — the cheap lever that costs no model',
    args: ['--effort', 'low'],
    change: 'Opus 5, effort lowered from medium to low. Around a fifth off the bill with the same model, ' +
      'and the thing to watch is whether the lookup-planning turns get sloppier — that is where the thinking earns its keep.',
  },
  {
    id: 'v2',
    why: 'Sonnet 5 — the question that started this',
    args: ['--model', 'claude-sonnet-5'],
    change: 'Claude Sonnet 5 in place of Opus 5, effort unchanged. About 60% cheaper. The mechanical work should hold; ' +
      'the two things to watch are the coverage caveats on partial data and whether the safety split still reads a question right.',
  },
];

const here = new URL('.', import.meta.url).pathname;

function run(args: string[]): number {
  const result = spawnSync('npx', ['tsx', join(here, 'run.ts'), ...args], { stdio: 'inherit' });
  return result.status ?? 1;
}

if (!hasCredentials()) {
  console.error(
    '\nNo Anthropic key found, so there is nothing to ask.\n\n' +
      '  npm run setup:ai     type your key in once; it writes .env\n' +
      '  npm run check:ai     check a key that is already set up\n\n' +
      'The key is the same one Squish uses in production — if it is only in your\n' +
      "host's dashboard, you will need a copy here to run this.\n",
  );
  process.exit(1);
}

console.log(`Using credentials from ${credentialSource()}.\n`);

for (const variant of VARIANTS) {
  console.log(`\n${'─'.repeat(64)}\n${variant.id}: ${variant.why}\n${'─'.repeat(64)}`);
  if (variant.change) {
    // What the report shows next to the number, so a row six weeks from now
    // still says what it was.
    mkdirSync(join(FLOW, variant.id), { recursive: true });
    writeFileSync(join(FLOW, variant.id, 'change.md'), `${variant.change}\n`);
  }
  const status = run(['--variant', variant.id, ...variant.args]);
  if (status !== 0) {
    console.error(`\n${variant.id} stopped. Run \`npm run eval\` again — it will carry on from here.`);
    process.exit(status);
  }
}

console.log(`\n${'─'.repeat(64)}\nBuilding the report\n${'─'.repeat(64)}`);
const built = spawnSync('node', [join(here, 'build-report.mjs'), FLOW], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const report = join(process.cwd(), FLOW, 'report.html');
if (existsSync(report)) {
  console.log(`\nOpen this in a browser:\n\n  ${report}\n\nEvery row links to the full transcript for that case — the question, what it`);
  console.log('looked up, what it answered, and the marking that decided the score.\n');
}
