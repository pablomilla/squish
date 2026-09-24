/**
 * Share cards.
 *
 * A picture of your streak that leaves the app and lands in a group chat, so
 * it has to stand on its own: the mascot, the number, and enough branding that
 * someone who has never heard of Squish knows what they are looking at.
 *
 * Always rendered in the light palette. A card is a fixed artefact, not themed
 * UI — nobody wants their progress posted in dark grey because their phone
 * happened to be in night mode.
 */
import { limit, wrap, type Measure } from './cardtext';
import { WORDMARK_ART, WORDMARK_VIEWBOX } from '../components/squish-art';
import type { Mood } from '../types';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

/**
 * The card's fixed bands. Everything is positioned against these rather than
 * flowed from the top, so that long wording shrinks to fit instead of sliding
 * down over the figures and the hill.
 */
const HILL_TOP = 1162;
const PILL_TOP = 972;
const PILL_HEIGHT = 150;
/** Between the mascot's feet and the figures: where the words go. */
const TEXT_TOP = 726;
const TEXT_BOTTOM = PILL_TOP - 24;
const SUB_LEADING = 50;

/** How big Squish is drawn, and where the feet land. */
const MASCOT_SIZE = 430;
const MASCOT_TOP = 250;

/**
 * The mascot's light skin tones, pinned here so a card drawn in dark mode still
 * comes out light. These are the only colours the artwork leaves themeable —
 * keep them in step with `--squish-skin-*` in squish.css.
 */
const MASCOT_LIGHT: Record<string, string> = {
  '--squish-skin-0': '#fffaf4',
  '--squish-skin-1': '#fdeadc',
  '--squish-skin-2': '#f6d7c4',
};

const BRAND = {
  bg: '#fdf6ec',
  surface: '#fffdfa',
  ink: '#2b2340',
  ink2: '#6b6480',
  ink3: '#9a93ab',
  brandSoft: '#e6e2fb',
  mint: '#c9e9d2',
  peach: '#fde4cf',
};

export interface ShareCardData {
  /** The one thing the card is about: "9 day streak". */
  headline: string;
  subline: string;
  /** Up to three supporting figures. */
  stats: { label: string; value: string }[];
  mood: Mood;
}

/**
 * Rasterise the mascot that is already on the page, rather than redrawing it.
 * CSS custom properties resolve inside a standalone SVG as long as they are
 * declared on its root, so they are inlined onto the clone before serialising.
 */
function rasterise(markup: string, what: string): Promise<HTMLImageElement> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`The ${what} would not render`));
    image.src = url;
  });
}

async function mascotImage(source: SVGSVGElement, size: number): Promise<HTMLImageElement> {
  const clone = source.cloneNode(true) as SVGSVGElement;
  // A tall hat reaches above the mascot's box. On screen it simply draws past
  // it; here the box is the picture, so it grows upwards to fit the hat and
  // the feet stay where they were.
  const rise = Number(source.dataset.rise) || 0;
  const [x, y, w, h] = (source.getAttribute('viewBox') ?? '0 0 1 1').split(/\s+/).map(Number);
  clone.setAttribute('viewBox', `${x} ${y - rise} ${w} ${h + rise}`);
  clone.setAttribute('width', String(size));
  clone.setAttribute('height', String(Math.round((size * (h + rise)) / h)));
  clone.removeAttribute('class'); // drop the animations; a still frame is wanted
  clone.querySelectorAll('[class]').forEach((el) => el.removeAttribute('class'));
  clone.setAttribute(
    'style',
    Object.entries(MASCOT_LIGHT)
      .map(([name, value]) => `${name}:${value}`)
      .join(';'),
  );

  return rasterise(new XMLSerializer().serializeToString(clone), 'mascot');
}

/**
 * The drawn logotype, not the name set in Fredoka. Built from the artwork
 * directly rather than cloned off the page: unlike the mascot, no wordmark is
 * necessarily on screen when a card is made. Its ink resolves to the light
 * values through the fallbacks already baked into the artwork.
 */
function wordmarkImage(width: number): Promise<HTMLImageElement> {
  const [, , w, h] = WORDMARK_VIEWBOX.split(' ').map(Number);
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${WORDMARK_VIEWBOX}" ` +
    `width="${width}" height="${(width * h) / w}">${WORDMARK_ART.replaceAll('__ID__', 'card-')}</svg>`;
  return rasterise(markup, 'wordmark');
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Fit the headline and subline into the text band, shrinking the headline
 * until the pair fits. A card is one image with no scrollbar: if the words do
 * not fit, the words have to give.
 */
function layOutWords(
  ctx: CanvasRenderingContext2D,
  data: ShareCardData,
): { headline: string[]; headlineSize: number; leading: number; subline: string[]; top: number } {
  const room = TEXT_BOTTOM - TEXT_TOP;
  const gap = 24;
  const measure: Measure = (text) => ctx.measureText(text).width;

  const attempt = (size: number, sublineLines: number) => {
    ctx.font = `600 ${size}px Fredoka, sans-serif`;
    const headline = limit(wrap(data.headline, CARD_WIDTH - 160, measure), 2);
    const leading = Math.round(size * 1.1);

    ctx.font = '500 38px Fredoka, sans-serif';
    const subline = limit(wrap(data.subline, CARD_WIDTH - 220, measure), sublineLines);

    return { headline, headlineSize: size, leading, subline, height: headline.length * leading + gap + subline.length * SUB_LEADING };
  };

  // Shrink the headline before shortening the subline — a smaller headline is
  // still the whole headline, whereas a shortened subline has lost words.
  let block = attempt(62, 1);
  for (const sublineLines of [2, 1]) {
    for (const size of [104, 88, 74, 62]) {
      const candidate = attempt(size, sublineLines);
      if (candidate.height <= room) return { ...candidate, top: TEXT_TOP + (room - candidate.height) / 2 };
      block = candidate;
    }
  }

  // Nothing fits, which takes wording we do not write. Top-align what is left.
  return { ...block, top: TEXT_TOP };
}

/** Make sure the brand faces are available before any text is measured. */
async function readyFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('600 96px Fredoka'),
      document.fonts.load('500 36px Fredoka'),
      document.fonts.load('700 44px Caveat'),
    ]);
    await document.fonts.ready;
  } catch {
    /* the card still renders in a fallback face */
  }
}

/**
 * Decoration for a card, as SVG markup already fetched: a frame for the edges
 * and up to two stickers beside Squish. What may be used is decided before it
 * gets here (`lib/shareDecor.ts`); this only draws.
 */
export interface CardDecor {
  frame?: string;
  stickers?: string[];
}

/**
 * The two sticker slots the designer was given, either side of Squish: x
 * 60–300 and 780–1020, y 260–660. Each sticker is drawn a little smaller than
 * its slot and tipped, like a real one stuck on, and stays inside the slot at
 * that angle.
 */
const STICKER_SIZE = 200;
const STICKER_SLOTS = [
  { x: 180, y: 470, turn: -8 },
  { x: 900, y: 470, turn: 8 },
];

/** An SVG document at a given pixel size, ready to draw. */
function sized(markup: string, width: number, height: number, what: string): Promise<HTMLImageElement> {
  return rasterise(markup.replace(/<svg\b/, `<svg width="${width}" height="${height}"`), what);
}

export async function renderShareCard(data: ShareCardData, mascot: SVGSVGElement, decor: CardDecor = {}): Promise<Blob> {
  await readyFonts();

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser will not draw a card');

  const centre = CARD_WIDTH / 2;

  ctx.fillStyle = BRAND.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Soft shapes, echoing the brand sheet: a lavender wash behind the mascot
  // and a mint hill along the foot. The wash stops above the headline — text
  // straddling its edge looked like a mistake.
  ctx.fillStyle = BRAND.brandSoft;
  ctx.beginPath();
  ctx.ellipse(centre, 452, 366, 268, 0, 0, Math.PI * 2); // sits around the mascot, clear of the headline
  ctx.fill();

  ctx.fillStyle = BRAND.peach;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(120, 180, 150, 120, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = BRAND.mint;
  ctx.beginPath();
  ctx.ellipse(centre, HILL_TOP + 290, 780, 290, 0, 0, Math.PI * 2);
  ctx.fill();

  const squish = await mascotImage(mascot, MASCOT_SIZE);
  // Taller than it is wide when wearing a tall hat: the extra goes above.
  const tall = squish.height || MASCOT_SIZE;
  ctx.drawImage(squish, centre - MASCOT_SIZE / 2, MASCOT_TOP - (tall - MASCOT_SIZE), MASCOT_SIZE, tall);

  const stickers = await Promise.all((decor.stickers ?? []).slice(0, STICKER_SLOTS.length).map((svg) => sized(svg, STICKER_SIZE, STICKER_SIZE, 'sticker')));
  stickers.forEach((sticker, i) => {
    const slot = STICKER_SLOTS[i];
    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.rotate((slot.turn * Math.PI) / 180);
    ctx.drawImage(sticker, -STICKER_SIZE / 2, -STICKER_SIZE / 2, STICKER_SIZE, STICKER_SIZE);
    ctx.restore();
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const words = layOutWords(ctx, data);

  ctx.fillStyle = BRAND.ink;
  ctx.font = `600 ${words.headlineSize}px Fredoka, sans-serif`;
  words.headline.forEach((line, i) => ctx.fillText(line, centre, words.top + i * words.leading));

  ctx.fillStyle = BRAND.ink2;
  ctx.font = '500 38px Fredoka, sans-serif';
  const sublineTop = words.top + words.headline.length * words.leading + 24;
  words.subline.forEach((line, i) => ctx.fillText(line, centre, sublineTop + i * SUB_LEADING));

  // Supporting figures, evenly spaced.
  const stats = data.stats.slice(0, 3);
  if (stats.length) {
    const pillWidth = 280;
    const gap = 24;
    const totalWidth = stats.length * pillWidth + (stats.length - 1) * gap;
    const top = PILL_TOP;
    stats.forEach((stat, i) => {
      const x = (CARD_WIDTH - totalWidth) / 2 + i * (pillWidth + gap);
      ctx.fillStyle = BRAND.surface;
      roundedRect(ctx, x, top, pillWidth, PILL_HEIGHT, 38);
      ctx.fill();
      ctx.fillStyle = BRAND.ink;
      ctx.font = '600 52px Fredoka, sans-serif';
      ctx.fillText(stat.value, x + pillWidth / 2, top + 28);
      ctx.fillStyle = BRAND.ink3;
      ctx.font = '500 30px Fredoka, sans-serif';
      ctx.fillText(stat.label, x + pillWidth / 2, top + 96);
    });
  }

  // The bit that does the work once this leaves the app: the drawn logotype,
  // so a card carries the same mark as the app and the store listing rather
  // than the name typed in whatever font the phone managed to load.
  //
  // A frame owns the bottom 64px, which the tagline normally dips into, so a
  // framed card sets the mark a little smaller and higher to finish above it.
  const framed = Boolean(decor.frame);
  const [, , wordW, wordH] = WORDMARK_VIEWBOX.split(' ').map(Number);
  const markWidth = framed ? 232 : 268;
  const markTop = framed ? 1160 : 1194;
  const markHeight = (markWidth * wordH) / wordW;
  const wordmark = await wordmarkImage(markWidth);
  ctx.drawImage(wordmark, centre - markWidth / 2, markTop, markWidth, markHeight);

  ctx.fillStyle = BRAND.ink2;
  ctx.font = `700 ${framed ? 34 : 38}px Caveat, cursive`;
  ctx.fillText('your little health buddy', centre, markTop + markHeight + 6);

  // Last, over everything: it only ever draws in the outer band and corners.
  if (decor.frame) ctx.drawImage(await sized(decor.frame, CARD_WIDTH, CARD_HEIGHT, 'frame'), 0, 0, CARD_WIDTH, CARD_HEIGHT);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The card would not save'))), 'image/png');
  });
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Hand the card to the system share sheet, or fall back to a download.
 * File sharing is Web Share Level 2 — present on iOS Safari and Android
 * Chrome, absent on most desktops.
 */
export async function shareCard(blob: Blob, text: string): Promise<ShareOutcome> {
  const file = new File([blob], 'squish.png', { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (error) {
      // A dismissed share sheet rejects with AbortError — not a failure.
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }

  // Firefox needs the link in the document, and revoking the URL in the same
  // tick cancels the download in Chrome — hence the delay.
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'squish.png';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
  return 'downloaded';
}
