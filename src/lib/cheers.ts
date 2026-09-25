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
export interface Cheer {
  id: string;
  emoji: string;
  words: string;
}

export const CHEERS: Cheer[] = [
  { id: 'streak', emoji: '🎉', words: 'Nice streak!' },
  { id: 'got-this', emoji: '💪', words: "You've got this" },
  { id: 'proud', emoji: '🌟', words: 'Proud of you' },
  { id: 'keep-going', emoji: '🙌', words: 'Keep it up' },
  { id: 'veg', emoji: '🥦', words: 'Veg hero' },
  { id: 'fuelled', emoji: '🥗', words: 'Fuelled up today' },
  { id: 'water', emoji: '💧', words: "Don't forget your water" },
  { id: 'on-fire', emoji: '🔥', words: 'On fire this week' },
  { id: 'smashed', emoji: '🥳', words: 'Goal smashed!' },
  { id: 'small-steps', emoji: '🌱', words: 'Small steps count' },
  { id: 'missed-you', emoji: '👋', words: 'Missed you today' },
  { id: 'new-day', emoji: '🌅', words: "Tomorrow's a fresh start" },
  { id: 'hug', emoji: '🤗', words: 'Sending a hug' },
  { id: 'great-day', emoji: '☀️', words: 'Have a great day' },
  { id: 'rest', emoji: '🌙', words: 'Rest well' },
  { id: 'squad-love', emoji: '💜', words: 'Squad love' },
];

export const cheerById = (id: string): Cheer | undefined => CHEERS.find((cheer) => cheer.id === id);

/**
 * Squad names, picked rather than typed, for the same reason. Friendly,
 * food-ish, and never about bodies.
 */
export const SQUAD_NAMES = [
  'The Avocados',
  'Team Broccoli',
  'The Blueberries',
  'Sweet Peas',
  'The Crunchy Carrots',
  'Lentil Legends',
  'The Smoothie Crew',
  'Team Sunshine',
  'The Porridge Club',
  'Salad Days',
  'The Chickpeas',
  'Team Tangerine',
] as const;

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
