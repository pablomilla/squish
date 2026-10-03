/**
 * Which tier somebody is on, and what that entitles them to.
 *
 * The free/paid line is not a product decision made here — it falls out of
 * what each action costs, and it is written down in docs/monetisation.md.
 * Everything cheap to serve is free forever: manual logging, food search, the
 * diary, charts, streaks, the earned colourways, export. Everything with a
 * bill attached is Plus: AI meal analysis beyond a one-off taste of it, the
 * nutritionist, recipe import, and the Plus colourways.
 *
 * **Free gets a taste, once — not an allowance every month.** A monthly free
 * allowance is a bill that grows with every free user who ever signs up and
 * never pays; with a few per cent converting, it came to more than the
 * subscribers' own AI (see docs/monetisation.md). A taste is a one-off cost
 * per person, capped, and it answers the only question a free user is asking
 * — is the analysis any good? — just as well.
 *
 * **The taste needs an account.** Otherwise clearing a browser's data is a
 * fresh taste, for ever. It is also counted against the browser, so making a
 * second account in the same one does not start it again.
 *
 * Two more things about the allowances are deliberate and easy to get wrong
 * later.
 *
 * **Plus has an allowance too.** A heavy user costs more per month than Plus
 * charges, so without a ceiling the best customers are the ones losing the
 * most money. The numbers below are the "moderate" profile from the costings —
 * two photos and a question a day — which is what the price was set against.
 *
 * **Plus's are monthly, not daily.** A daily cap punishes the person who logs a
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
 * What each tier gets: free once, Plus without a limit for one person's own
 * eating — see PERIOD.
 *
 * Free is ten AI analyses — a photo or a description — and five questions for
 * the nutritionist, once. Enough to find out whether either is any good; on
 * Gemini the whole taste costs about 20 cents.
 *
 * Plus is unlimited, with a fair-use ceiling a day (docs/monetisation.md, "Fair
 * use"): 40 analyses, 50 questions and 10 recipe imports, eight to fifteen
 * times what a heavy day of real eating uses. Nobody eating and logging
 * meets them; a script, or a household on one account, does. They reset at
 * midnight (UTC, when the database's day turns). A real heavy user — five
 * meals and three questions a day — costs about $3–4 a month on Gemini, inside
 * even the yearly price; somebody at every ceiling every day would cost more,
 * which is what the ceilings are for.
 *
 * Under the UK's advertising rules an "unlimited" plan may only manage use
 * well past what a legitimate user does, and must say how: these ceilings
 * are stated on the plans page and in the terms. Lowering them far is a
 * decision about the word "unlimited", not only about margin.
 */
export const ALLOWANCE: Record<Plan, Record<Billable, number>> = {
  free: {
    photo: count('SQUISH_FREE_TASTE', 10),
    // A taste of the nutritionist, like the taste of photo analysis: five
    // questions with a free account, once. It is the thing people upgrade
    // for, and nobody upgrades for something they have never tried.
    chat: count('SQUISH_FREE_CHATS', 5),
    recipe: count('SQUISH_FREE_RECIPES', 0),
  },
  plus: {
    photo: count('SQUISH_PLUS_PHOTOS_A_DAY', 40),
    chat: count('SQUISH_PLUS_CHATS_A_DAY', 50),
    recipe: count('SQUISH_PLUS_RECIPES_A_DAY', 10),
  },
};

export type Period = 'day' | 'ever';

/** How each tier's allowance is counted: free once, Plus's fair-use ceiling by the day. */
export const PERIOD: Record<Plan, Period> = { free: 'ever', plus: 'day' };

/**
 * The nutritionist's weekly plan: Plus only, and the one thing on Plus with a
 * stated number rather than "unlimited" — a week of meals is the largest
 * single thing Squish asks of the AI. Two a week (Monday to Sunday) is a fresh
 * plan whenever the first did not suit. Each also counts as a question.
 */
export const WEEKPLANS_PER_WEEK = count('SQUISH_PLUS_WEEKPLANS_A_WEEK', 2);

const NOTHING: Record<Billable, number> = { photo: 0, chat: 0, recipe: 0 };

/**
 * What this device may spend on its plan. A signed-out device on the free
 * plan gets nothing: the taste belongs to an account.
 */
export function allowanceFor(device: Device, plan: Plan): Record<Billable, number> {
  if (plan === 'free' && !device.accountId) return NOTHING;
  return ALLOWANCE[plan];
}

/**
 * Extra AI on top of an allowance, while it lasts. Inviting a friend while on
 * Plus used to add some (server/friends.ts); with Plus unlimited it no longer
 * does, and a fair-use ceiling is not something to top up — so nothing is
 * added today. Kept so boosts already granted have somewhere to be read, and
 * for an allowance that one day needs topping up again.
 */
export async function extrasFor(device: Device, plan: Plan): Promise<Record<Billable, number>> {
  if (plan !== 'plus' || !device.accountId || PERIOD.plus === 'day') return NOTHING;
  const rows = await query<{ photo: string; chat: string; recipe: string }>(
    `select coalesce(sum(photo), 0) as photo, coalesce(sum(chat), 0) as chat, coalesce(sum(recipe), 0) as recipe
       from allowance_boosts where account_id = $1 and granted_at <= now() and expires_at > now()`,
    [device.accountId],
  );
  const row = rows[0];
  return { photo: Number(row?.photo ?? 0), chat: Number(row?.chat ?? 0), recipe: Number(row?.recipe ?? 0) };
}

/** The allowance with any extras added: what is actually enforced. */
export async function allowanceWithExtras(device: Device, plan: Plan): Promise<Record<Billable, number>> {
  const base = allowanceFor(device, plan);
  const extra = await extrasFor(device, plan);
  return Object.fromEntries(BILLABLE.map((kind) => [kind, base[kind] + extra[kind]])) as Record<Billable, number>;
}

/** Whether signing up would give this device something to try. */
export const needsAccount = (device: Device, plan: Plan): boolean =>
  plan === 'free' && !device.accountId && BILLABLE.some((kind) => ALLOWANCE.free[kind] > 0);

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
 * What this person has spent since the start of a day, week or month, across
 * every device they use.
 *
 * Counted against the owner rather than the device, or somebody signed in on a
 * phone and a laptop would get the allowance twice. `usage` is keyed by device
 * because that is what a request arrives with; the join is where a person is
 * reassembled from the devices they hold.
 */
async function usedSince(device: Device, kind: Billable | 'weekplan', since: 'day' | 'week' | 'month'): Promise<number> {
  const owner = device.accountId ?? device.id;
  const rows = await query<{ used: string }>(
    `select coalesce(sum(u.count), 0) as used
       from usage u
       join devices d on d.id = u.device_id
      where coalesce(d.account_id, d.id) = $1
        and u.kind = $2
        and u.day >= date_trunc($3, current_date)`,
    [owner, kind, since],
  );
  return Number(rows[0]?.used ?? 0);
}

export const usedToday = (device: Device, kind: Billable | 'weekplan') => usedSince(device, kind, 'day');
export const usedThisWeek = (device: Device, kind: Billable | 'weekplan') => usedSince(device, kind, 'week');
export const usedThisMonth = (device: Device, kind: Billable | 'weekplan') => usedSince(device, kind, 'month');

/**
 * Everything this person has ever spent of one kind — the free taste's count.
 *
 * The larger of the person's total and this browser's, so a second account
 * made in the same browser starts where the first left off.
 */
export async function usedEver(device: Device, kind: Billable): Promise<number> {
  const owner = device.accountId ?? device.id;
  const rows = await query<{ person: string; here: string }>(
    `select
       coalesce((select sum(u.count) from usage u join devices d on d.id = u.device_id
                  where coalesce(d.account_id, d.id) = $1 and u.kind = $3), 0) as person,
       coalesce((select sum(count) from usage where device_id = $2 and kind = $3), 0) as here`,
    [owner, device.id, kind],
  );
  return Math.max(Number(rows[0]?.person ?? 0), Number(rows[0]?.here ?? 0));
}

/** What counts against this plan's allowance: today's for Plus's fair-use ceiling, all of it for free. */
export const usedFor = (device: Device, kind: Billable, plan: Plan): Promise<number> =>
  PERIOD[plan] === 'ever' ? usedEver(device, kind) : usedToday(device, kind);

export interface Standing {
  plan: Plan;
  /** How the allowance is counted: 'day' is Plus's fair-use ceiling, back tomorrow; 'ever' does not come back. */
  period: Period;
  /** A signed-out device on the free plan, which an account would give a taste to. */
  needsAccount: boolean;
  used: Record<Billable, number>;
  allowance: Record<Billable, number>;
  left: Record<Billable, number>;
}

/** Everything the app needs to know to show a paywall before somebody hits it. */
export async function standingOf(device: Device): Promise<Standing> {
  const plan = await planFor(device);
  const allowance = await allowanceWithExtras(device, plan);
  const used = Object.fromEntries(
    await Promise.all(BILLABLE.map(async (kind) => [kind, await usedFor(device, kind, plan)] as const)),
  ) as Record<Billable, number>;

  return {
    plan,
    period: PERIOD[plan],
    needsAccount: needsAccount(device, plan),
    used,
    allowance,
    left: Object.fromEntries(BILLABLE.map((kind) => [kind, Math.max(0, allowance[kind] - used[kind])])) as Record<Billable, number>,
  };
}

/** When a daily fair-use ceiling comes back: the next midnight, UTC, when the database's day turns. */
export function nextReset(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

/** When the week's weekly plans come back: the next Monday, at midnight UTC. */
export function nextWeek(now = new Date()): string {
  const day = now.getUTCDay(); // 0 Sunday … 6 Saturday
  const ahead = ((8 - day) % 7) || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ahead)).toISOString();
}
