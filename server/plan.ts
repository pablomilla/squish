/**
 * Which tier somebody is on, and what that entitles them to.
 *
 * The free/paid line is not a product decision made here — it falls out of
 * what each action costs, and it is written down in docs/monetisation.md.
 * Everything cheap to serve is free forever: manual logging, food search, the
 * diary, charts, streaks, the earned colourways, export. Everything with a
 * bill attached is Plus: photo analysis beyond a taste of it, the
 * nutritionist, recipe import, and the Plus colourways.
 *
 * Two things about the allowances are deliberate and easy to get wrong later.
 *
 * **Plus has an allowance too.** A heavy user costs more per month than Plus
 * charges, so without a ceiling the best customers are the ones losing the
 * most money. The numbers below are the "moderate" profile from the costings —
 * two photos and a question a day — which is what the price was set against.
 *
 * **They are monthly, not daily.** A daily cap punishes the person who logs a
 * week's meals on Sunday evening and lets a steady user spend twice as much.
 * The month is the billing period, so the month is the budget.
 *
 * All of them are environment variables, because they are policy rather than
 * engineering, and the person who has to change them should not need a deploy
 * to think about it.
 */
import { query } from './db';
import type { Device, Spend } from './identity';

export type Plan = 'free' | 'plus';

/** The actions that cost real money, as opposed to the ones that guard a door. */
export const BILLABLE = ['photo', 'chat', 'recipe'] as const;
export type Billable = (typeof BILLABLE)[number];

export const isBillable = (kind: Spend): kind is Billable => (BILLABLE as readonly string[]).includes(kind);

const count = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};

/**
 * What each tier gets a month.
 *
 * Free is a taste of the thing that costs money and none of the thing that
 * costs most. Ten photos is enough to find out whether the analysis is any
 * good, which is the only question somebody deciding whether to pay is asking.
 *
 * Plus at 60 photos and 30 questions is at most about $3.40 (£2.65) of usage.
 * Against £6.99 a month that leaves room after VAT and the stores' cut, and
 * the £49.99 year still covers somebody who uses every last one. Raising it is
 * a decision about margin, not a kindness — see docs/monetisation.md.
 */
export const ALLOWANCE: Record<Plan, Record<Billable, number>> = {
  free: {
    photo: count('SQUISH_FREE_PHOTOS', 10),
    chat: count('SQUISH_FREE_CHATS', 0),
    recipe: count('SQUISH_FREE_RECIPES', 2),
  },
  plus: {
    photo: count('SQUISH_PLUS_PHOTOS', 60),
    chat: count('SQUISH_PLUS_CHATS', 30),
    recipe: count('SQUISH_PLUS_RECIPES', 30),
  },
};

/**
 * The tier this device is on.
 *
 * Free unless an account says otherwise, and an account only says otherwise
 * while its `plus_until` is still in the future. Anonymous devices are always
 * free: a subscription needs somewhere to live that survives a cleared
 * browser, and that somewhere is an account.
 */
export async function planFor(device: Device): Promise<Plan> {
  if (!device.accountId) return 'free';
  const rows = await query<{ live: boolean }>(
    'select plus_until is not null and plus_until > now() as live from accounts where id = $1',
    [device.accountId],
  );
  return rows[0]?.live ? 'plus' : 'free';
}

/**
 * What this person has spent this month, across every device they use.
 *
 * Counted against the owner rather than the device, or somebody signed in on a
 * phone and a laptop would get the allowance twice. `usage` is keyed by device
 * because that is what a request arrives with; the join is where a person is
 * reassembled from the devices they hold.
 */
export async function usedThisMonth(device: Device, kind: Billable): Promise<number> {
  const owner = device.accountId ?? device.id;
  const rows = await query<{ used: string }>(
    `select coalesce(sum(u.count), 0) as used
       from usage u
       join devices d on d.id = u.device_id
      where coalesce(d.account_id, d.id) = $1
        and u.kind = $2
        and u.day >= date_trunc('month', current_date)`,
    [owner, kind],
  );
  return Number(rows[0]?.used ?? 0);
}

export interface Standing {
  plan: Plan;
  used: Record<Billable, number>;
  allowance: Record<Billable, number>;
  left: Record<Billable, number>;
}

/** Everything the app needs to know to show a paywall before somebody hits it. */
export async function standingOf(device: Device): Promise<Standing> {
  const plan = await planFor(device);
  const allowance = ALLOWANCE[plan];
  const used = Object.fromEntries(
    await Promise.all(BILLABLE.map(async (kind) => [kind, await usedThisMonth(device, kind)] as const)),
  ) as Record<Billable, number>;

  return {
    plan,
    used,
    allowance,
    left: Object.fromEntries(BILLABLE.map((kind) => [kind, Math.max(0, allowance[kind] - used[kind])])) as Record<Billable, number>,
  };
}

/** When this month's allowance comes back, so the app can say so. */
export function nextReset(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
