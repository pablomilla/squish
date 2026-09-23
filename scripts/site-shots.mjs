/**
 * Screenshots of the real app for the website, with two weeks of believable
 * meals in it. Nobody's actual diary: everything below is made up here.
 *
 * Needs a built app being served and Playwright's Chromium:
 *
 *   npm run build && PORT=4173 npm start          # in one terminal
 *   node scripts/site-shots.mjs                    # in another
 *
 * Writes site/img/shot-*.jpg.
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const BASE = process.env.SHOTS_BASE ?? 'http://127.0.0.1:4173';
const OUT = resolve(process.cwd(), 'site/img');

const iso = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

const MENU = {
  breakfast: [
    ['Porridge with blueberries and honey', 380, 13, 62, 8, 7, 84],
    ['Greek yoghurt, granola and raspberries', 340, 20, 38, 11, 5, 80],
    ['Scrambled eggs on sourdough', 420, 24, 32, 21, 3, 72],
    ['Banana and peanut butter toast', 390, 12, 48, 16, 6, 74],
  ],
  lunch: [
    ['Chicken, avocado and quinoa salad', 520, 38, 36, 22, 9, 88],
    ['Lentil and tomato soup with a roll', 460, 22, 64, 9, 13, 86],
    ['Tuna and sweetcorn jacket potato', 540, 34, 70, 11, 7, 76],
    ['Falafel wrap with houmous', 580, 19, 68, 24, 10, 70],
  ],
  dinner: [
    ['Salmon, new potatoes and green beans', 610, 42, 44, 26, 7, 90],
    ['Vegetable stir-fry with tofu and rice', 560, 26, 72, 16, 8, 84],
    ['Spaghetti bolognese', 690, 36, 82, 20, 7, 68],
    ['Chickpea and spinach curry with rice', 620, 21, 90, 17, 14, 82],
  ],
  snack: [
    ['Apple and a handful of almonds', 190, 5, 20, 11, 5, 82],
    ['Oat flapjack', 240, 4, 30, 12, 3, 48],
    ['Hummus and carrot sticks', 160, 6, 14, 9, 6, 86],
  ],
};

const TIMES = { breakfast: '08:05', lunch: '12:50', snack: '15:40', dinner: '18:45' };

function meals() {
  const out = [];
  for (let day = 13; day >= 0; day--) {
    const slots = day === 0 ? ['breakfast', 'lunch', 'snack'] : ['breakfast', 'lunch', 'snack', 'dinner'];
    for (const slot of slots) {
      if (slot === 'snack' && day % 3 === 1) continue;
      const pick = MENU[slot][(day * 7 + slot.length) % MENU[slot].length];
      const [title, calories, protein, carbs, fat, fibre, score] = pick;
      out.push({
        id: `m-${day}-${slot}`,
        date: iso(day),
        time: TIMES[slot],
        slot,
        title,
        items: [],
        // Rough but plausible: sugar from carbs, salt as sodium in mg.
        nutrients: { calories, protein, carbs, fat, fibre, sugar: Math.round(carbs * 0.18), freeSugar: Math.round(carbs * 0.08), sodium: Math.round(calories * 0.9) },
        score,
        source: slot === 'snack' ? 'search' : 'photo',
      });
    }
  }
  return out;
}

const days = Array.from({ length: 14 }, (_, i) => ({
  date: iso(13 - i),
  water: 5 + ((i * 3) % 4),
  steps: 6200 + ((i * 1733) % 5200),
  weightKg: +(79.4 - i * 0.12 + ((i % 3) - 1) * 0.15).toFixed(1),
}));

const PROFILE = {
  name: 'Sam', sex: 'none', age: 34, heightCm: 172, weightKg: 77.8, targetWeightKg: 72,
  activity: 'light', goal: 'lose', pace: 0.5, units: 'metric', onboarded: true,
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.addInitScript(
  ([profile, meals, days]) => {
    if (localStorage.getItem('shots-seeded')) return;
    localStorage.setItem('shots-seeded', '1');
    localStorage.setItem('squish-v1', JSON.stringify({ version: 5, state: { profile, meals, days } }));
  },
  [PROFILE, meals(), days],
);

await page.goto(BASE);
await page.waitForTimeout(2500);
await page.screenshot({ path: resolve(OUT, 'shot-home.jpg'), type: 'jpeg', quality: 82 });

const tab = (i) => page.locator('.tabbar button').nth(i);
await tab(1).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(OUT, 'shot-diary.jpg'), type: 'jpeg', quality: 82 });

await tab(3).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: resolve(OUT, 'shot-insights.jpg'), type: 'jpeg', quality: 82 });

await browser.close();
console.log(`Wrote screenshots to ${OUT}`);
