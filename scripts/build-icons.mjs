/**
 * Squish's icons, drawn from the artwork already in the repository:
 *
 *   The app — the "S" and heart from the wordmark (site/img/wordmark.svg),
 *   cream on the brand purple. On the iPhone and Android home screens, the
 *   installed web app, the app's browser tab, and the logo in emails.
 *
 *   The website — Squish's face, close up (from public/squish-hello.svg), on
 *   the same purple. In the website's browser tabs, bookmarks and search
 *   results, so the site and the app are told apart at a glance.
 *
 * Both are bold on purpose: they have to read at 16px in a tab.
 *
 *   node scripts/build-icons.mjs
 *
 * Writes:
 *   public/app-icon.svg, favicon.ico, apple-touch-icon.png, icon-192.png,
 *     icon-512.png, icon-maskable-512-v3.png       (the web app)
 *   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
 *                                                  (1024², no transparency, as Apple asks)
 *   android/app/src/main/res/mipmap-* /ic_launcher*.png and
 *     values/ic_launcher_background.xml             (Android, adaptive and older)
 *   site/squish-face.svg, favicon.ico, apple-touch-icon.png  (the website)
 *
 * Phones and browsers keep an icon under its name for weeks: when the art
 * changes, bump MASKABLE_VERSION and public/manifest.webmanifest with it.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const PURPLE = '#6B5FE0';
const PURPLE_DEEP = '#5A4ED3';
const CREAM = '#FFFAF4';
const MASKABLE_VERSION = 3;

const wordmark = readFileSync(resolve('site/img/wordmark.svg'), 'utf8');
const pathD = (id) => new RegExp(`<path id="${id}"[^>]*\\sd="([^"]+)"`).exec(wordmark)[1];
const S = pathD('wm-letter-S');
const HEART = pathD('wm-heart-dot');

const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` } : {});
const page = await browser.newPage();

/** The bounding box of a path, as the browser measures it. */
const bbox = (d) =>
  page.evaluate((d) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
    document.body.append(svg);
    const { x, y, width, height } = path.getBBox();
    svg.remove();
    return { x, y, width, height };
  }, d);
const sBox = await bbox(S);
const heartBox = await bbox(HEART);

/**
 * The app icon on a 1024 square. `height` is how tall the S stands, as a
 * share of the square; `tile` says whether the purple fills it (false for
 * Android's foreground layer, which goes over its own background).
 */
function appIcon({ height, tile = true }) {
  const size = 1024;
  const k = (height * size) / sBox.height;
  const heartK = (0.62 * sBox.width * k) / heartBox.width;
  // The heart perches on the S's top-right shoulder, as the dot does on the i.
  const sW = sBox.width * k;
  const sH = sBox.height * k;
  const hW = heartBox.width * heartK;
  const hH = heartBox.height * heartK;
  const hX = sW - 0.34 * hW;
  const hY = -0.22 * hH;
  // Centre S and heart together.
  const left = Math.min(0, hX);
  const top = Math.min(0, hY);
  const groupW = Math.max(sW, hX + hW) - left;
  const groupH = Math.max(sH, hY + hH) - top;
  const ox = (size - groupW) / 2 - left;
  const oy = (size - groupH) / 2 - top;
  const place = (box, scale, x, y) => `translate(${(ox + x).toFixed(2)} ${(oy + y).toFixed(2)}) scale(${scale.toFixed(4)}) translate(${-box.x} ${-box.y})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Squish">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${PURPLE}"/><stop offset="1" stop-color="${PURPLE_DEEP}"/></linearGradient>
<linearGradient id="heart" x1="0" y1="0" x2="1" y2=".65"><stop stop-color="#FFB4C3"/><stop offset=".5" stop-color="#F4899F"/><stop offset="1" stop-color="#F27795"/></linearGradient>
<filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${(0.012 * size).toFixed(1)}" stdDeviation="${(0.014 * size).toFixed(1)}" flood-color="#2A1F6B" flood-opacity=".28"/></filter>
</defs>
${tile ? `<rect width="${size}" height="${size}" fill="url(#bg)"/>` : ''}
<g filter="url(#lift)">
<path fill="${CREAM}" transform="${place(sBox, k, 0, 0)}" d="${S}"/>
<path fill="url(#heart)" transform="${place(heartBox, heartK, hX, hY)}" d="${HEART}"/>
</g>
</svg>
`;
}

/** The website's icon: Squish's face filling a purple square, still (no blinking in a tab). */
function siteIcon() {
  const hello = readFileSync(resolve('public/squish-hello.svg'), 'utf8');
  const [x, y, w] = [130, 84, 280];
  return hello
    .replace(/<style>[\s\S]*?<\/style>/, '')
    // Its excitement lines would only show as a pink sliver in the corner.
    .replace(/<g id="hello-accents"[\s\S]*?<\/g>/, '')
    .replace(/viewBox="[^"]*"/, `viewBox="${x} ${y} ${w} ${w}"`)
    .replace(/aria-label="[^"]*"/, 'aria-label="Squish"')
    .replace(/(<svg[^>]*>)/, `$1<rect x="${x}" y="${y}" width="${w}" height="${w}" fill="${PURPLE}"/>`);
}

/**
 * Pixels of `svg` drawn at `size`, optionally clipped to a rounded square or
 * a circle — RGBA, straight from the browser's own renderer.
 */
async function pixels(svg, size, shape = 'square') {
  const data = await page.evaluate(
    async ({ svg, size, shape }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const g = canvas.getContext('2d');
      if (shape === 'circle') {
        g.beginPath();
        g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        g.clip();
      } else if (shape === 'rounded') {
        g.beginPath();
        g.roundRect(0, 0, size, size, size * 0.18);
        g.clip();
      }
      g.drawImage(img, 0, 0, size, size);
      return Array.from(g.getImageData(0, 0, size, size).data);
    },
    { svg, size, shape },
  );
  return Uint8Array.from(data);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A PNG of RGBA pixels; `opaque` drops the alpha channel altogether (Apple's App Store icon). */
function png(rgba, size, opaque = false) {
  const channels = opaque ? 3 : 4;
  const rows = Buffer.alloc(size * (size * channels + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * channels + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = y * (size * channels + 1) + 1 + x * channels;
      for (let c = 0; c < channels; c++) rows[to + c] = rgba[from + c];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** A .ico holding PNGs, which every browser since IE has read. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const write = (file, data) => {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(resolve(file), data);
  console.log(`Wrote ${file}`);
};
const pngOf = async (svg, size, { shape, opaque } = {}) => png(await pixels(svg, size, shape), size, opaque);
const icoOf = async (svg, sizes) => ico(await Promise.all(sizes.map(async (size) => ({ size, data: await pngOf(svg, size) }))));

// ---------- The app ----------
// Full squares: the browser and iPhone round the corners themselves.
const full = appIcon({ height: 0.6 });
// Maskable and Android's foreground: everything inside the safe circle.
const safe = appIcon({ height: 0.46 });
const foreground = appIcon({ height: 0.36, tile: false });
// Tabs are tiny: let the S fill more of them.
const tab = appIcon({ height: 0.7 });

write('public/app-icon.svg', tab);
write('public/favicon.ico', await icoOf(tab, [16, 32, 48]));
write('public/apple-touch-icon.png', await pngOf(full, 180, { opaque: true }));
write('public/icon-192.png', await pngOf(full, 192, { opaque: true }));
write('public/icon-512.png', await pngOf(full, 512, { opaque: true }));
write(`public/icon-maskable-512-v${MASKABLE_VERSION}.png`, await pngOf(safe, 512, { opaque: true }));
write('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', await pngOf(full, 1024, { opaque: true }));

const ANDROID = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(ANDROID)) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  // Before Android 8: the whole icon, shaped by us.
  write(`${dir}/ic_launcher.png`, await pngOf(safe, 48 * scale, { shape: 'rounded' }));
  write(`${dir}/ic_launcher_round.png`, await pngOf(safe, 48 * scale, { shape: 'circle' }));
  // Android 8 on: the S and heart alone, over the purple background colour.
  write(`${dir}/ic_launcher_foreground.png`, await pngOf(foreground, 108 * scale));
}
write(
  'android/app/src/main/res/values/ic_launcher_background.xml',
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${PURPLE}</color>\n</resources>\n`,
);

// ---------- The website ----------
const face = siteIcon();
write('site/squish-face.svg', face);
write('site/favicon.ico', await icoOf(face, [16, 32, 48]));
write('site/apple-touch-icon.png', await pngOf(face, 180, { opaque: true }));

await browser.close();
