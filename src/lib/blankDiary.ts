/**
 * A diary with nothing in it: never set up, and nothing logged or planned.
 * The one kind the backup may replace without asking (lib/autobackup.ts),
 * because there is nothing in it anybody could lose. Kept apart from the
 * backup itself so the rule can be tested without a browser.
 */
export function isBlank(state: unknown): boolean {
  if (!state || typeof state !== 'object') return true;
  const diary = state as { profile?: { onboarded?: boolean }; meals?: unknown[]; days?: Record<string, unknown>; plans?: unknown[] };
  return !diary.profile?.onboarded && !diary.meals?.length && !Object.keys(diary.days ?? {}).length && !diary.plans?.length;
}
