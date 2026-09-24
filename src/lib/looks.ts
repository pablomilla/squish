/**
 * How Squish looks.
 *
 * The artwork fixes every colour except three skin tones, which are custom
 * properties — so a whole new look is three values, and it applies to all
 * seven poses, the share card and both themes without anything being
 * redrawn. That asymmetry is the reason this exists at all: recolouring is
 * nearly free, and a new character is seven commissioned poses.
 *
 * Every look here is earned. Nothing is bought, because the question worth
 * answering first is whether anybody cares how Squish looks, and a price tag
 * answers a different question. If they do care, adding one later is small.
 *
 * They are earned against things the app already tracked — the same
 * achievements the You screen has always shown. No new counters, no new
 * things to keep, and nothing that rewards logging more food than somebody
 * ate: a streak is showing up, not eating.
 */
import type { Achievement } from '../types';
import { PLUS } from './subscription';

/**
 * How a look is come by. A union rather than two optional fields, so a look
 * that is both earned and sold — which would cheapen both — cannot be written.
 */
export type Unlock =
  | { kind: 'always' }
  | { kind: 'achievement'; id: Achievement['id'] }
  | { kind: 'subscriber' };

/**
 * A finish: what makes a Plus look wild rather than just another colour.
 *
 * It replaces the two gradients the artwork paints the body and arms with —
 * nothing else — so the artwork's own highlight, edge shading and floor
 * shadow still sit on top, and a rainbow or gold Squish still reads as the
 * same round, lit shape. The face is never touched.
 */
export interface Finish {
  /** Colour stops along the gradient, as [offset 0–1, colour]. */
  stops: [number, string][];
  /**
   * How it moves. `drift` slides the colours slowly across the body;
   * `sweep` sends a light across metal every few seconds. Never for somebody
   * who has asked for less motion, and never on a share card.
   */
  motion?: 'drift' | 'sweep';
  /**
   * Stripes instead of a blend: the stops repeat every this many units along
   * the diagonal. Hard stops in pairs make hard-edged stripes.
   */
  stripe?: number;
}

export interface Look {
  id: string;
  name: string;
  /** How it is come by, in the words the locked swatch shows. */
  how: string;
  unlock: Unlock;
  /** Highlight, body, shadow — light theme then dark. */
  light: [string, string, string];
  dark: [string, string, string];
  finish?: Finish;
}

/**
 * Six, in the order they are most likely to be earned.
 *
 * The tones keep the same relationship in every one: a near-white highlight,
 * a body, and a shadow about two steps deeper. Break that and the character
 * stops reading as the same shape lit the same way — it goes flat, or it
 * looks like a different blob wearing a colour.
 */
export const LOOKS: Look[] = [
  {
    id: 'squish',
    name: 'Squish',
    how: 'The original',
    unlock: { kind: 'always' },
    light: ['#fffaf4', '#fdeadc', '#f6d7c4'],
    dark: ['#fdf3ea', '#f4ddcc', '#e2bfa9'],
  },
  {
    id: 'peach',
    name: 'Peach',
    how: 'Log your first meal',
    unlock: { kind: 'achievement', id: 'first-meal' },
    light: ['#fff6f2', '#fcd9cb', '#f5bda8'],
    dark: ['#ffeee7', '#f8c9b5', '#e8a98f'],
  },
  {
    id: 'blueberry',
    name: 'Blueberry',
    how: 'Three days running',
    unlock: { kind: 'achievement', id: 'streak-3' },
    light: ['#f6f5ff', '#ddd9fb', '#c3bcf2'],
    dark: ['#eeecfd', '#cdc7f6', '#ada4e6'],
  },
  {
    id: 'matcha',
    name: 'Matcha',
    how: 'Hit your fibre target',
    unlock: { kind: 'achievement', id: 'fibre-hit' },
    light: ['#f7fbf2', '#dcecd0', '#c2dcb0'],
    dark: ['#eff7e8', '#cbe3ba', '#aecb98'],
  },
  {
    id: 'cocoa',
    name: 'Cocoa',
    how: 'A full week of logging',
    unlock: { kind: 'achievement', id: 'streak-7' },
    light: ['#faf3ee', '#e6d2c2', '#d0b39d'],
    dark: ['#f2e6db', '#d8bda6', '#bb9a7f'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    how: 'Thirty days of logging',
    unlock: { kind: 'achievement', id: 'streak-30' },
    light: ['#f0f1f7', '#cbd0e2', '#a8b0cc'],
    dark: ['#e5e8f2', '#b9c0d8', '#949dbb'],
  },
];

/**
 * And six that come with Squish Plus.
 *
 * Not more of the same: the earned colourways are soft, single colours, and
 * these are finishes — rainbow, holographic, real metal, stripes — that no
 * amount of logging turns up. Two sets that differ only by which ones you
 * happen to have look like a paywall dropped through the middle of one set;
 * two sets that look nothing alike look like a choice.
 *
 * Still no new shapes: a finish is two gradients swapped in the artwork,
 * which is why it stays nearly free. The three tones alongside each are for
 * the parts a finish does not repaint — the highlight and the edges.
 */
export const PLUS_LOOKS: Look[] = [
  {
    id: 'rainbow', name: 'Rainbow', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#fffaf7', '#ffd6e0', '#c9b8ff'],
    dark: ['#fff3f6', '#ffc6d4', '#b9a5ff'],
    finish: {
      stops: [[0, '#ff9aa9'], [0.18, '#ffc58a'], [0.34, '#fff08a'], [0.5, '#9be8a6'], [0.66, '#8fd3ff'], [0.82, '#b9a2ff'], [1, '#f5a3e6']],
      motion: 'drift',
    },
  },
  {
    id: 'holo', name: 'Holographic', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#ffffff', '#e9ecff', '#cfd6ff'],
    dark: ['#ffffff', '#e0e4ff', '#c2cbff'],
    finish: {
      // Pearly but not pale: strong enough to shift colour as it moves, light enough to stay pearl.
      stops: [[0, '#ffc2ec'], [0.18, '#aef3df'], [0.36, '#c7b5ff'], [0.52, '#ffd3ae'], [0.68, '#a6d8ff'], [0.84, '#f0b9ff'], [1, '#b8f0e8']],
      motion: 'drift',
    },
  },
  {
    id: 'gold', name: 'Gold', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#fff8dc', '#f3cf6b', '#c99a33'],
    dark: ['#fff4d2', '#ecc45d', '#bf8f2b'],
    finish: {
      // Bands of light and dark are what make metal read as metal rather than yellow.
      stops: [[0, '#fff5d0'], [0.16, '#f2cd68'], [0.3, '#fff1bf'], [0.46, '#d6a53a'], [0.62, '#ffe7a0'], [0.8, '#b8862a'], [1, '#f1d587']],
      motion: 'sweep',
    },
  },
  {
    id: 'chrome', name: 'Chrome', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#ffffff', '#d6dce3', '#9aa6b3'],
    dark: ['#ffffff', '#ccd3db', '#8e9aa8'],
    finish: {
      stops: [[0, '#ffffff'], [0.15, '#cfd6de'], [0.3, '#f7f9fb'], [0.46, '#9eaab7'], [0.62, '#eef1f5'], [0.8, '#86929f'], [1, '#dde2e8']],
      motion: 'sweep',
    },
  },
  {
    id: 'candy', name: 'Candy', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#fff7f9', '#ffd1dc', '#f7a8bb'],
    dark: ['#fff1f5', '#ffc2d1', '#ee97ad'],
    finish: {
      stops: [[0, '#ffb3c6'], [0.5, '#ffb3c6'], [0.5, '#fff7f9'], [1, '#fff7f9']],
      stripe: 46,
    },
  },
  {
    id: 'sunset', name: 'Sunset', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#fff4ec', '#ffb38a', '#ff7fa3'],
    dark: ['#ffede2', '#ffa679', '#f96f96'],
    finish: {
      stops: [[0, '#ffe27a'], [0.35, '#ffac6b'], [0.7, '#ff7fa3'], [1, '#d88bff']],
      motion: 'drift',
    },
  },
];

/** Everything, in the order the picker shows it. */
export const ALL_LOOKS: Look[] = [...LOOKS, ...PLUS_LOOKS];

export const DEFAULT_LOOK = LOOKS[0].id;

export const lookById = (id: string): Look => ALL_LOOKS.find((look) => look.id === id) ?? LOOKS[0];

/** Earned, subscribed to, or the one everybody starts with. */
export function isUnlocked(look: Look, unlocked: Record<string, string>, subscribed: boolean): boolean {
  switch (look.unlock.kind) {
    case 'always':
      return true;
    case 'achievement':
      return Boolean(unlocked[look.unlock.id]);
    case 'subscriber':
      return subscribed;
  }
}

/**
 * The three properties to set, for a look and a theme.
 *
 * Returned rather than applied so the caller decides where they land — on the
 * document for the app, on one element for a swatch showing a look somebody
 * has not chosen.
 */
export function lookVars(look: Look, dark: boolean): Record<string, string> {
  const [zero, one, two] = dark ? look.dark : look.light;
  return { '--squish-skin-0': zero, '--squish-skin-1': one, '--squish-skin-2': two };
}

/**
 * The gradient a finish paints with, as SVG, in the artwork's own coordinates
 * so the body and arms carry one continuous sweep of colour rather than each
 * starting it again. `still` leaves out the movement.
 */
export function finishGradient(id: string, finish: Finish, still: boolean): string {
  // The artwork's skin gradient runs from (200, 100) to (450, 620).
  const [x1, y1] = [200, 100];
  const [x2, y2] = finish.stripe ? [x1 + finish.stripe, y1 + finish.stripe] : [450, 620];
  const stops = finish.stops.map(([offset, colour]) => `<stop offset="${offset}" stop-color="${colour}"/>`).join('');
  const motion =
    still || !finish.motion
      ? ''
      : finish.motion === 'sweep'
        ? '<animateTransform attributeName="gradientTransform" type="translate" values="-180 -180;180 180;-180 -180" keyTimes="0;0.5;1" dur="5s" repeatCount="indefinite"/>'
        : '<animateTransform attributeName="gradientTransform" type="translate" values="0 0;160 260;0 0" dur="9s" repeatCount="indefinite"/>';
  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ` +
    `spreadMethod="${finish.stripe ? 'repeat' : 'reflect'}">${stops}${motion}</linearGradient>`
  );
}
