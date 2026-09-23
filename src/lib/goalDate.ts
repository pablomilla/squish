/**
 * When a goal weight would be reached at the chosen pace — a date, because
 * "around March" means something and "17 weeks" mostly does not.
 *
 * Also notices a goal pointing the wrong way — losing weight towards a number
 * higher than today's — so setup can say so kindly instead of quietly working
 * out a plan for the opposite of what somebody meant.
 */
export type GoalProjection =
  | { kind: 'date'; date: Date; weeks: number }
  /** Goal weight is on the wrong side of today's for the goal chosen. */
  | { kind: 'mismatch'; suggest: 'lose' | 'gain' }
  /** Already there, give or take. */
  | { kind: 'there' }
  | null;

/** Close enough to count as the same weight: about half a pound. */
const NEAR_KG = 0.25;

export function goalProjection(
  p: { weightKg: number; targetWeightKg: number; goal: 'lose' | 'maintain' | 'gain'; pace: number },
  today: Date = new Date(),
): GoalProjection {
  if (p.goal === 'maintain' || !(p.pace > 0)) return null;
  const change = p.targetWeightKg - p.weightKg;
  if (Math.abs(change) <= NEAR_KG) return { kind: 'there' };
  if (p.goal === 'lose' && change > 0) return { kind: 'mismatch', suggest: 'gain' };
  if (p.goal === 'gain' && change < 0) return { kind: 'mismatch', suggest: 'lose' };
  const weeks = Math.ceil(Math.abs(change) / p.pace);
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + weeks * 7);
  return { kind: 'date', date, weeks };
}

/** "March 2027", or "next month" / "this month" when it is that close. */
export function aroundWhen(date: Date, today: Date = new Date()): string {
  const months = (date.getFullYear() - today.getFullYear()) * 12 + date.getMonth() - today.getMonth();
  if (months <= 0) return 'this month';
  if (months === 1) return 'next month';
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
