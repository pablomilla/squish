/** Kept apart from backup.ts, which talks to the server, so it can be tested without a browser. */
export interface DiarySummary {
  meals: number;
  /** The most recent day with a meal on it, yyyy-mm-dd. */
  latest: string | null;
}

/**
 * How much is in a diary, for choosing between two of them: a count and the
 * last day logged. Reads only what it needs, and anything it does not
 * recognise counts as nothing rather than failing.
 */
export function summariseDiary(state: unknown): DiarySummary {
  const meals = (state as { meals?: unknown } | null)?.meals;
  if (!Array.isArray(meals)) return { meals: 0, latest: null };
  let latest: string | null = null;
  for (const meal of meals) {
    const date = (meal as { date?: unknown } | null)?.date;
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && (!latest || date > latest)) latest = date;
  }
  return { meals: meals.length, latest };
}
