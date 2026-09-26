/**
 * What squad members can say to each other: a fixed set of kind things, and
 * nothing typed.
 *
 * That is deliberate, not a first version waiting for a text box. Free text
 * between people is where a food app goes wrong — "you ate *that*?", weight
 * comparisons, "encouragement" to eat less — and it is user-to-user content
 * under the Online Safety Act, with the risk assessment, reporting and
 * moderation that brings. A menu of cheers carries the warmth without any of
 * it. Every one is about showing up and looking after yourself; none is about
 * eating less, weighing less, or anybody's body.
 *
 * Shared by the app (to show them) and the server (to accept only these).
 */
import { msg, t } from './i18n';

export interface Cheer {
  id: string;
  emoji: string;
  words: string;
}

export const CHEERS: Cheer[] = [
  { id: 'streak', emoji: '🎉', words: t('Nice streak!') },
  { id: 'got-this', emoji: '💪', words: t("You've got this") },
  { id: 'proud', emoji: '🌟', words: t('Proud of you') },
  { id: 'keep-going', emoji: '🙌', words: t('Keep it up') },
  { id: 'veg', emoji: '🥦', words: t('Veg hero') },
  { id: 'fuelled', emoji: '🥗', words: t('Fuelled up today') },
  { id: 'water', emoji: '💧', words: t("Don't forget your water") },
  { id: 'on-fire', emoji: '🔥', words: t('On fire this week') },
  { id: 'smashed', emoji: '🥳', words: t('Goal smashed!') },
  { id: 'small-steps', emoji: '🌱', words: t('Small steps count') },
  { id: 'missed-you', emoji: '👋', words: t('Missed you today') },
  { id: 'new-day', emoji: '🌅', words: t("Tomorrow's a fresh start") },
  { id: 'hug', emoji: '🤗', words: t('Sending a hug') },
  { id: 'great-day', emoji: '☀️', words: t('Have a great day') },
  { id: 'rest', emoji: '🌙', words: t('Rest well') },
  { id: 'squad-love', emoji: '💜', words: t('Squad love') },
];

export const cheerById = (id: string): Cheer | undefined => CHEERS.find((cheer) => cheer.id === id);

/**
 * Squad names, picked rather than typed, for the same reason. Friendly,
 * food-ish, and never about bodies. Stored and checked in English, so a
 * squad keeps its name whatever language each member reads it in: shown with
 * `t(name)`.
 */
export const SQUAD_NAMES = [
  msg('The Avocados'),
  msg('Team Broccoli'),
  msg('The Blueberries'),
  msg('Sweet Peas'),
  msg('The Crunchy Carrots'),
  msg('Lentil Legends'),
  msg('The Smoothie Crew'),
  msg('Team Sunshine'),
  msg('The Porridge Club'),
  msg('Salad Days'),
  msg('The Chickpeas'),
  msg('Team Tangerine'),
];

/** How many days each member aims to log in a week, for the squad goal. */
export const SQUAD_WEEK_GOAL = 5;
export const SQUAD_MAX = 5;

/**
 * A display name: letters (any alphabet), spaces, apostrophes and hyphens, up
 * to 20. Enough for "Mary-Jane" or "Siân"; not enough to write a message in.
 */
export const tidyDisplayName = (name: unknown): string | null => {
  if (typeof name !== 'string') return null;
  const tidy = name.normalize('NFC').replace(/\s+/g, ' ').trim();
  return /^[\p{L}][\p{L}\p{M} '’-]{0,19}$/u.test(tidy) ? tidy : null;
};
