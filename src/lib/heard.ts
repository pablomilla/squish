/**
 * How somebody heard about Squish, asked once in onboarding.
 *
 * Kept against the device as one key from this list — never free text, never
 * anything that says who told them — so the dashboard can count which ways in
 * lead to people who stay. Shared by the app and the server.
 */
import { t } from './i18n';

export type Heard = 'friend' | 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'search' | 'store' | 'podcast' | 'press' | 'other';

export const HEARD: { key: Heard; emoji: string; label: string }[] = [
  { key: 'friend', emoji: '🧑‍🤝‍🧑', label: t('A friend or family') },
  { key: 'tiktok', emoji: '🎵', label: 'TikTok' },
  { key: 'instagram', emoji: '📷', label: 'Instagram' },
  { key: 'youtube', emoji: '▶️', label: 'YouTube' },
  { key: 'facebook', emoji: '👍', label: 'Facebook' },
  { key: 'search', emoji: '🔎', label: t('Searching online') },
  { key: 'store', emoji: '📲', label: t('The app store') },
  { key: 'podcast', emoji: '🎙️', label: t('A podcast') },
  { key: 'press', emoji: '📰', label: t('An article or the news') },
  { key: 'other', emoji: '✨', label: t('Somewhere else') },
];

const KEYS = new Set<string>(HEARD.map((h) => h.key));
export const isHeard = (value: unknown): value is Heard => typeof value === 'string' && KEYS.has(value);
