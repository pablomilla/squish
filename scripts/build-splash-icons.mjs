/**
 * The manifest's "any" icons: Squish on nothing, rather than on the lilac
 * square of the home-screen icon.
 *
 * Android builds the screen it shows while an installed web app starts from
 * the manifest: the background colour, with the "any" icon in the middle.
 * With the lilac tile there, opening Squish showed a lilac square first and
 * then index.html's splash — Squish alone on cream — a moment later, which
 * reads as an old loading screen giving way to a new one. Drawn from the same
 * waving Squish as public/squish-hello.svg, the two are the same picture.
 *
 * The home-screen icon itself is the maskable one, which keeps its tile; the
 * iPhone uses apple-touch-icon.png, which is untouched.
 *
 * The file names carry a version, because phones and browsers keep an icon
 * under its name for weeks. Change the art, bump the number, and update
 * public/manifest.webmanifest to match.
 *
 *   node scripts/build-splash-icons.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION = 2;
const hello = readFileSync(resolve('public/squish-hello.svg'), 'utf8');
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` } : {});

for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, reducedMotion: 'reduce' });
  // A little air round the edge, so no launcher crops an ear.
  const pad = Math.round(size * 0.06);
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(hello).toString('base64')}" style="display:block;width:${size - 2 * pad}px;height:${size - 2 * pad}px;margin:${pad}px"></body></html>`,
  );
  await page.waitForTimeout(200);
  const out = resolve(`public/icon-any-${size}-v${VERSION}.png`);
  await page.screenshot({ path: out, omitBackground: true });
  console.log(`Wrote ${out}`);
  await page.close();
}
await browser.close();
