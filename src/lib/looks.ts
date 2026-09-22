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

export interface Look {
  id: string;
  name: string;
  /** How it is come by, in the words the locked swatch shows. */
  how: string;
  unlock: Unlock;
  /** Highlight, body, shadow — light theme then dark. */
  light: [string, string, string];
  dark: [string, string, string];
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
 * Deliberately richer than the earned set rather than more of it — the earned
 * colourways are pale and soft, these are saturated. Two sets that differ only
 * by which ones you happen to have look like a paywall dropped through the
 * middle of one set; two sets that look different look like a choice.
 *
 * Still three tones and no new shapes: the moment a look needs its own artwork
 * it stops being nearly free, which was the whole reason to start here.
 */
export const PLUS_LOOKS: Look[] = [
  {
    id: 'terracotta', name: 'Terracotta', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#fef2ec', '#f6c9ae', '#e8a37e'],
    dark: ['#fbe8de', '#edb595', '#d68d66'],
  },
  {
    id: 'seafoam', name: 'Seafoam', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#eefaf7', '#bfe8de', '#9bd5c7'],
    dark: ['#e4f5f0', '#a9dbcf', '#86c0b2'],
  },
  {
    id: 'lilac', name: 'Lilac', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#fbf3fd', '#ebd2f2', '#d9b3e6'],
    dark: ['#f6ebfa', '#dcbde8', '#c39dd2'],
  },
  {
    id: 'honey', name: 'Honey', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#fffaeb', '#fae5b0', '#f2d184'],
    dark: ['#fdf3dd', '#f2d89a', '#ddbc6f'],
  },
  {
    id: 'rose', name: 'Rose', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#fff1f4', '#fac3ce', '#f29eae'],
    dark: ['#fde7ec', '#f4aebd', '#e0899b'],
  },
  {
    id: 'slate', name: 'Slate', how: PLUS, unlock: { kind: 'subscriber' },
    light: ['#f2f5f7', '#cdd9e0', '#adbfca'],
    dark: ['#e8eef2', '#b8c9d3', '#93a8b5'],
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
