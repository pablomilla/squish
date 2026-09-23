/** How the dashboard writes numbers. Money arrives in pence and leaves as pounds. */

const MINUS = '−';

/** £12.34, or £1,234 once the pennies stop mattering. */
export function pounds(pence: number, opts: { whole?: boolean; sign?: boolean } = {}): string {
  const abs = Math.abs(pence) / 100;
  const whole = opts.whole ?? abs >= 1000;
  const text = abs.toLocaleString('en-GB', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  const sign = pence < 0 ? MINUS : opts.sign && pence > 0 ? '+' : '';
  return `${sign}£${text}`;
}

/** A cost per call, where pennies are the point: 3.3p, or £1.20 once it is more than a pound. */
export const perCall = (pence: number): string => (Math.abs(pence) < 100 ? `${pence.toFixed(1)}p` : pounds(Math.round(pence)));

export const count = (n: number): string => n.toLocaleString('en-GB');

export const percent = (share: number, digits = 0): string => `${(share * 100).toFixed(digits)}%`;

/** 23 Sep */
export const shortDay = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Tue 23 Sep */
export const longDay = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** September 2026 */
export const monthName = (month: string): string =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Sep */
export const shortMonth = (month: string): string =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/**
 * Change against the period before, as words a person reads: "▲ 12% on the
 * 30 days before". Nothing to compare with says so, rather than "+∞%".
 */
export function delta(now: number, before: number): { arrow: '▲' | '▼' | '' ; text: string } {
  if (before === 0 && now === 0) return { arrow: '', text: 'no change' };
  if (before === 0) return { arrow: '▲', text: 'new' };
  const change = (now - before) / before;
  if (Math.abs(change) < 0.005) return { arrow: '', text: 'no change' };
  return { arrow: change > 0 ? '▲' : '▼', text: percent(Math.abs(change)) };
}

/** The category names, in the order they are always drawn. */
export const KIND_LABEL: Record<string, string> = { photo: 'Meal analyses', chat: 'Nutritionist', recipe: 'Recipe imports' };
export const KINDS = ['photo', 'chat', 'recipe'] as const;
/** Fixed order, never cycled — validated as a set (see admin.css). */
export const KIND_COLOR: Record<string, string> = { photo: 'var(--dv-1)', chat: 'var(--dv-2)', recipe: 'var(--dv-3)' };
