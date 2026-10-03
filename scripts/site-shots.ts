/**
 * Screenshots of the real app for the website, in every language it speaks.
 *
 * Each language gets the app in that language with a fortnight of made-up
 * meals in it (src/lib/demoDiary.ts), the meals in that language too, so the
 * Spanish page shows a Spanish phone. The website picks a language's
 * screenshots when it has them, and the English ones when it does not
 * (server/site.ts).
 *
 * Translations come from the server it photographs: asking for a language
 * starts it translating anything missing, and this waits until the language
 * is complete. A language still incomplete after SHOTS_WAIT_S is skipped
 * rather than photographed half in English, and the run says so.
 *
 *   npx tsx scripts/site-shots.ts                         # every language, from a local server
 *   SHOTS_LANGS=en,es npx tsx scripts/site-shots.ts       # some
 *   SHOTS_BASE=https://app.squish.online npx tsx scripts/site-shots.ts
 *
 * Needs the app served at SHOTS_BASE (locally: npm run build && npm start)
 * and Playwright's Chromium; CHROMIUM points at another one. For the
 * languages that need them, the machine needs Noto fonts (CJK, Arabic,
 * Devanagari, Bengali, Gurmukhi) — see .github/workflows/site-shots.yml.
 *
 * Writes site/img/shots/<language>/<screen>.jpg.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoState } from '../src/lib/demoDiary';
import { computeTargets } from '../src/lib/nutrition';
import { idOf, type Translation } from '../src/lib/i18n';
import { LANGUAGE_LIST, type Language } from '../src/lib/language';
import type { Region } from '../src/lib/region';

const BASE = (process.env.SHOTS_BASE ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const OUT = resolve(process.cwd(), 'site/img/shots');
const WAIT_S = Number(process.env.SHOTS_WAIT_S ?? 600);

/** A set of screenshots: the language the app speaks, and the country, which decides spelling and units. */
interface Shot {
  /** The folder, and what the website looks for: a language, or en-US for American English. */
  key: string;
  language: Language;
  region: Region;
  units: 'metric' | 'imperial';
}

const ALL: Shot[] = [
  ...LANGUAGE_LIST.map((l) => ({ key: l.id, language: l.id, region: 'GB' as Region, units: 'metric' as const })),
  { key: 'en-US', language: 'en', region: 'US', units: 'imperial' },
];
const asked = (process.env.SHOTS_LANGS ?? 'all').split(',').map((s) => s.trim()).filter(Boolean);
const SHOTS = asked.includes('all') ? ALL : ALL.filter((s) => asked.includes(s.key));

/** What the server says about somebody on Plus with nothing used today. */
const PLUS_STANDING = {
  known: true,
  account: true,
  plan: 'plus',
  period: 'day',
  needsAccount: false,
  taste: 10,
  used: { photo: 2, chat: 1, recipe: 0 },
  allowance: { photo: 40, chat: 50, recipe: 10 },
  left: { photo: 38, chat: 49, recipe: 10 },
  weekplans: { used: 1, allowance: 2 },
  resets: null,
  off: false,
  invites: false,
  admin: false,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The words for a language from the server, once they are all there; null if they never were. */
async function wordsFor(shot: Shot): Promise<Record<string, Translation> | null> {
  const pack = shot.key === 'en' ? null : shot.key === 'en-US' ? 'en-US' : shot.language;
  if (!pack) return {};
  const until = Date.now() + WAIT_S * 1000;
  for (;;) {
    const res = await fetch(`${BASE}/api/i18n/${pack}`).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { complete: boolean; messages: Record<string, Translation> };
      if (body.complete) return body.messages;
      if (Date.now() > until) {
        console.log(`  ${shot.key}: ${Object.keys(body.messages).length} strings translated so far, not all — skipped.`);
        return null;
      }
    } else if (Date.now() > until) {
      console.log(`  ${shot.key}: the server would not give its words (${res?.status ?? 'no answer'}) — skipped.`);
      return null;
    }
    await sleep(10_000);
  }
}

async function snap(page: Page, dir: string, name: string): Promise<void> {
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(dir, `${name}.jpg`), type: 'jpeg', quality: 82 });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const done: string[] = [];
const skipped: string[] = [];

for (const shot of SHOTS) {
  const words = await wordsFor(shot);
  if (!words) {
    skipped.push(shot.key);
    continue;
  }
  const say = (english: string) => {
    const found = words[idOf(english)];
    return typeof found === 'string' ? found : english;
  };
  const state = demoState(isoToday(), say, { language: shot.language, region: shot.region, units: shot.units });
  const seeded = { ...state, targets: computeTargets(state.profile) };
  const dir = resolve(OUT, shot.key);
  mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: shot.key === 'en-US' ? 'en-US' : shot.language });
  const page = await context.newPage();
  await page.addInitScript((persisted: typeof seeded) => {
    if (localStorage.getItem('shots-seeded')) return;
    localStorage.setItem('shots-seeded', '1');
    // Nothing to tell a phone that only exists for a photograph.
    localStorage.setItem('squish-policy-seen', '9999-12-31');
    localStorage.setItem('squish-v1', JSON.stringify({ version: 5, state: persisted }));
  }, seeded);

  // Photographed as somebody on Plus, and kept to itself: the app's own words
  // come from the server, and nothing else reaches it — no device registered,
  // nothing synced, no AI asked.
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/i18n/') || path === '/api/health' || path === '/api/build') return route.continue();
    if (path === '/api/device') return route.fulfill({ json: { id: 'site-shots', token: 'site-shots' } });
    if (path === '/api/allowance') return route.fulfill({ json: PLUS_STANDING });
    return route.fulfill({ status: 503, json: { error: 'Not for screenshots.' } });
  });

  try {
    await page.goto(BASE);
    await page.waitForSelector('.home', { timeout: 30_000 });
    await page.waitForTimeout(2500);
    await snap(page, dir, 'home');

    const tab = (i: number) => page.locator('.tabbar button').nth(i);
    await tab(1).click();
    await snap(page, dir, 'diary');

    await tab(3).click();
    await page.waitForTimeout(1200);
    await snap(page, dir, 'insights');

    // Ask Squish, on the week it planned.
    await tab(0).click();
    await page.locator('.nutri-plan').click();
    await page.locator('.meal-plan-head').waitFor();
    await snap(page, dir, 'plan');

    // Tonight's recipe, then cooking it a step at a time.
    await page.locator('.plan-card-body').first().click();
    await page.waitForTimeout(800);
    await snap(page, dir, 'recipe');
    await page.locator('.cook-actions .btn').first().click();
    await page.waitForTimeout(1200);
    await snap(page, dir, 'cook');
    done.push(shot.key);
    console.log(`  ${shot.key}: done`);
  } catch (error) {
    skipped.push(shot.key);
    console.log(`  ${shot.key}: failed — ${error instanceof Error ? error.message.split('\n')[0] : error}`);
  }
  await context.close();
}

await browser.close();
console.log(`Wrote ${done.length} sets of screenshots to ${OUT}${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}.`);
if (!done.length) process.exitCode = 1;
