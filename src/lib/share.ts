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
import type { Mood } from '../types';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

/**
 * The card's fixed bands. Everything is positioned against these rather than
 * flowed from the top, so that long wording shrinks to fit instead of sliding
 * down over the figures and the hill.
 */
const HILL_TOP = 1210;
const PILL_TOP = 1012;
const PILL_HEIGHT = 150;
/** Between the mascot's feet and the figures: where the words go. */
const TEXT_TOP = 726;
const TEXT_BOTTOM = PILL_TOP - 24;
const SUB_LEADING = 50;

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
async function mascotImage(source: SVGSVGElement, size: number): Promise<HTMLImageElement> {
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(size));
  clone.setAttribute('height', String(size));
  clone.removeAttribute('class'); // drop the animations; a still frame is wanted
  clone.querySelectorAll('[class]').forEach((el) => el.removeAttribute('class'));
  clone.setAttribute(
    'style',
    Object.entries(MASCOT_LIGHT)
      .map(([name, value]) => `${name}:${value}`)
      .join(';'),
  );

  const markup = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The mascot would not render'));
    image.src = url;
  });
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
  let fitted = null as null | { headline: string[]; headlineSize: number; leading: number; subline: string[]; height: number };

  for (const size of [104, 88, 74, 62]) {
    ctx.font = `600 ${size}px Fredoka, sans-serif`;
    const headline = limit(wrap(data.headline, CARD_WIDTH - 160, measure), 2);
    const leading = Math.round(size * 1.1);

    ctx.font = '500 38px Fredoka, sans-serif';
    const subline = limit(wrap(data.subline, CARD_WIDTH - 220, measure), 2);

    const height = headline.length * leading + gap + subline.length * SUB_LEADING;
    fitted = { headline, headlineSize: size, leading, subline, height };
    if (height <= room) break;
  }

  const block = fitted as NonNullable<typeof fitted>;
  return { ...block, top: TEXT_TOP + Math.max(0, (room - block.height) / 2) };
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

export async function renderShareCard(data: ShareCardData, mascot: SVGSVGElement): Promise<Blob> {
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
  ctx.ellipse(centre, 440, 380, 285, 0, 0, Math.PI * 2); // bottom lands on TEXT_TOP
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

  const squish = await mascotImage(mascot, 460);
  ctx.drawImage(squish, centre - 230, 240, 460, 460);

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

  // The bit that does the work once this leaves the app.
  ctx.fillStyle = BRAND.ink;
  ctx.font = '600 58px Fredoka, sans-serif';
  ctx.fillText('Squish', centre, CARD_HEIGHT - 148);
  ctx.fillStyle = BRAND.ink2;
  ctx.font = '700 40px Caveat, cursive';
  ctx.fillText('your little health buddy', centre, CARD_HEIGHT - 82);

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
