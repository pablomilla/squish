/**
 * Squish credential setup.
 *
 *   npm run setup:ai     prompt for a key, check it, then write .env
 *   npm run check:ai     just check whatever credentials are already configured
 *
 * The key is typed in, never passed as an argument — arguments land in shell
 * history and in the process list. Nothing here prints the key back in full.
 */
import Anthropic from '@anthropic-ai/sdk';
import { credentialSource } from '../server/claude';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENV_PATH = resolve(process.cwd(), '.env');
const MODEL = process.env.SQUISH_MODEL ?? 'claude-opus-5';
const CONSOLE_URL = 'https://console.anthropic.com/settings/keys';

const ESC = String.fromCharCode(27);
const paint = (code: string) => (text: string) => `${ESC}[${code}m${text}${ESC}[0m`;
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const red = paint('31');
const amber = paint('33');

const ENTER = ['\r', '\n'];
const CTRL_C = String.fromCharCode(3);
const BACKSPACE = [String.fromCharCode(127), String.fromCharCode(8)];

/** sk-ant-api03-abc…w9Xy — enough to tell two keys apart, not enough to use one. */
export function mask(key: string): string {
  if (key.length < 16) return '…';
  return `${key.slice(0, 14)}…${key.slice(-4)}`;
}

/** Read a line without echoing it, so the key never appears on screen. */
async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      rl.close();
      return line.trim();
    }
    return '';
  }

  process.stdout.write(prompt);
  return new Promise((resolvePrompt, rejectPrompt) => {
    const stdin = process.stdin;
    let buffer = '';

    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (ENTER.includes(char)) {
          cleanup();
          process.stdout.write('\n');
          resolvePrompt(buffer.trim());
          return;
        }
        if (char === CTRL_C) {
          cleanup();
          process.stdout.write('\n');
          rejectPrompt(new Error('Cancelled'));
          return;
        }
        if (BACKSPACE.includes(char)) {
          buffer = buffer.slice(0, -1);
          continue;
        }
        if (char >= ' ') buffer += char;
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

interface CheckResult {
  ok: boolean;
  headline: string;
  hint?: string;
}

/**
 * One tiny real request, capped at a single output token, so it costs a
 * fraction of a penny. Counting tokens alone would pass on an account with no
 * credit on it, which is the failure people actually hit.
 */
async function check(apiKey?: string): Promise<CheckResult> {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  try {
    await client.messages.create({
      model: MODEL,
      max_tokens: 1,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: 'hi' }],
    });
    return { ok: true, headline: `Working — ${MODEL} answered.` };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return {
        ok: false,
        headline: 'That key was not accepted.',
        hint: `Check for a stray space or a truncated paste, or make a fresh key at ${CONSOLE_URL}`,
      };
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      return {
        ok: false,
        headline: 'The key is valid but not allowed to use this model.',
        hint: 'Its workspace may restrict models. Try another key, or set SQUISH_MODEL to one the workspace allows.',
      };
    }
    if (error instanceof Anthropic.NotFoundError) {
      return {
        ok: false,
        headline: `This account cannot reach "${MODEL}".`,
        hint: 'Set SQUISH_MODEL in .env to a model your account has, e.g. claude-sonnet-5.',
      };
    }
    if (error instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(error.message)) {
      return {
        ok: false,
        headline: 'The key works, but the account has no credit on it.',
        hint: 'Add credit under Billing in the console — API usage is prepaid, separate from a Claude.ai plan.',
      };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return {
        ok: false,
        headline: 'Rate limited on the very first call.',
        hint: 'Wait a moment, then run npm run check:ai again.',
      };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return {
        ok: false,
        headline: 'Could not reach the API at all.',
        hint: 'Check the network, a VPN, or a proxy sitting in front of api.anthropic.com.',
      };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, headline: `API error ${error.status}: ${error.message}` };
    }
    return { ok: false, headline: error instanceof Error ? error.message : String(error) };
  }
}

/** Replace the key line in an existing .env, keeping everything else intact. */
export function upsertKey(existing: string, key: string): string {
  const line = `ANTHROPIC_API_KEY=${key}`;
  if (/^ANTHROPIC_API_KEY=/m.test(existing)) {
    return existing.replace(/^ANTHROPIC_API_KEY=.*$/m, line);
  }
  return existing.trim() ? `${existing.replace(/\n*$/, '')}\n${line}\n` : `${line}\n`;
}

async function readEnvFile(): Promise<string> {
  try {
    return await readFile(ENV_PATH, 'utf8');
  } catch {
    return '';
  }
}

function keyFromEnvFile(contents: string): string | undefined {
  return contents.match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1]?.trim();
}

/** Only worth mentioning when it points somewhere other than the real API. */
function warnAboutBaseUrl(): void {
  const base = process.env.ANTHROPIC_BASE_URL?.trim().replace(/\/+$/, '');
  if (!base || base === 'https://api.anthropic.com') return;
  console.log(amber(`  Note: ANTHROPIC_BASE_URL is set to ${base}.`));
  console.log(dim('  Requests go there rather than to api.anthropic.com.\n'));
}

function report(result: CheckResult): void {
  console.log(result.ok ? `  ${green('✓')} ${result.headline}` : `  ${red('✗')} ${result.headline}`);
  if (result.hint) console.log(`  ${dim(result.hint)}`);
}

async function runCheck(): Promise<void> {
  // Federation has no key to show — the SDK exchanges a host-issued token.
  if (credentialSource() === 'federation') {
    console.log(`  Using workload identity federation against ${bold(MODEL)}…`);
    const result = await check();
    report(result);
    console.log('');
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const configured =
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.ANTHROPIC_AUTH_TOKEN?.trim() ||
    keyFromEnvFile(await readEnvFile());

  if (!configured) {
    console.log(red('  No credentials found.'));
    console.log(`  Run ${bold('npm run setup:ai')} to add a key, or ${bold('ant auth login')} if you use the CLI.`);
    console.log(dim('  Squish still runs without one — meals fall back to the offline estimator.\n'));
    process.exitCode = 1;
    return;
  }

  console.log(`  Checking ${dim(mask(configured))} against ${bold(MODEL)}…`);
  const result = await check(configured);
  report(result);
  console.log('');
  process.exitCode = result.ok ? 0 : 1;
}

async function runSetup(): Promise<void> {
  const existing = await readEnvFile();
  const current = keyFromEnvFile(existing);

  if (current && current !== 'sk-ant-...') {
    console.log(`  .env already has a key: ${dim(mask(current))}`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('  Replace it? [y/N] ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log(dim('\n  Left as it is. Run npm run check:ai to test it.\n'));
      return;
    }
    console.log('');
  }

  console.log(`  Create a key at ${bold(CONSOLE_URL)} — it is shown once, so copy it there and then.`);
  console.log(dim('  Paste it below. It is not echoed, and it never leaves this machine.\n'));

  const key = await readSecret('  Key: ');

  if (!key) {
    console.log(red('\n  Nothing entered — no changes made.\n'));
    process.exitCode = 1;
    return;
  }
  if (!key.startsWith('sk-ant-')) {
    console.log(red('\n  That does not look like an Anthropic key — they start with "sk-ant-".'));
    console.log(dim('  No changes made.\n'));
    process.exitCode = 1;
    return;
  }

  console.log(`\n  Checking ${dim(mask(key))} against ${bold(MODEL)}…`);
  const result = await check(key);

  if (!result.ok) {
    report(result);
    console.log(dim('\n  Not written to .env. Fix the above, then run npm run setup:ai again.\n'));
    process.exitCode = 1;
    return;
  }

  await writeFile(ENV_PATH, upsertKey(existing, key), { mode: 0o600 });
  await chmod(ENV_PATH, 0o600).catch(() => {});

  report(result);
  console.log(`  ${green('✓')} Saved to .env ${dim('(owner-read-only, and gitignored)')}\n`);
  console.log(`  Start it up: ${bold('npm run dev')}`);
  console.log(dim('  You → Squish AI in the app should now read "Connected".\n'));
}

async function main(): Promise<void> {
  console.log(`\n${bold('🫧  Squish · Anthropic credentials')}\n`);
  warnAboutBaseUrl();
  await (process.argv.includes('--check') ? runCheck() : runSetup());
}

// Importable for tests; only prompts when run as a command.
const runDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (runDirectly) {
  main().catch((error: unknown) => {
    console.log(red(`\n  ${error instanceof Error ? error.message : String(error)}\n`));
    process.exitCode = 1;
  });
}
