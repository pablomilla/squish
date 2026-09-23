/** The dashboard's pages, in the order the menu shows them. */
export const SECTIONS = [
  { key: 'overview', label: 'Overview', icon: '🏠' },
  { key: 'money', label: 'Money', icon: '💷' },
  { key: 'people', label: 'People', icon: '👥' },
  { key: 'usage', label: 'AI usage', icon: '✨' },
  { key: 'affiliates', label: 'Affiliates', icon: '🤝' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
] as const;

export type Section = (typeof SECTIONS)[number]['key'];

export const isSection = (value: unknown): value is Section => SECTIONS.some((s) => s.key === value);
