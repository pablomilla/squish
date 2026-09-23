/**
 * The dashboard behind the app: who is signed up, what they are on, and what
 * it is all costing.
 *
 * Who counts as an admin is an environment variable listing email addresses,
 * and nothing else. That is deliberate: it means there is no admin password
 * to leak, no admin account to compromise separately, and no way to promote
 * yourself from inside the app. An admin signs in exactly as everybody else
 * does — same scrypt, same rate limit, same device token — and the list says
 * whether that person also sees this.
 *
 *   SQUISH_ADMIN_EMAILS=you@example.com,someone@else.com
 *
 * Unset means nobody is an admin and every route here is closed, which is the
 * right default for a deployment nobody has configured.
 *
 * **What this deliberately cannot see: anybody's diary.** Not their meals, not
 * their photographs, not what the nutritionist remembers about them. Running
 * the service needs to know that somebody used eleven analyses; it does not
 * need to know what they had for lunch, and the privacy policy says as much.
 * Counts and totals only.
 */
import { query } from './db';
import type { Device } from './identity';
import { ALLOWANCE, type Plan } from './plan';
import { canSendMail, sendMail } from './mail';

/**
 * Send one email to the admin asking, to prove the setup works.
 *
 * The only honest way to know mail is configured is to receive one. Throws
 * with the provider's own explanation, because "the from-address domain is
 * not verified" is the likeliest failure and the least guessable.
 */
export async function sendTestMail(to: string): Promise<void> {
  await sendMail({
    to,
    subject: 'Squish can send email',
    text: [
      'This is the test email from the Squish dashboard.',
      '',
      'If you are reading it, confirmation links, password resets and security notices will reach people too.',
    ].join('\n'),
  });
}

export const mailReady = (): boolean => canSendMail();

const admins = (): string[] =>
  (process.env.SQUISH_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export const adminsExist = (): boolean => admins().length > 0;

/** Whether this device is signed in as somebody on the list. */
export async function isAdmin(device: Device | undefined): Promise<boolean> {
  if (!device?.accountId || !adminsExist()) return false;
  const rows = await query<{ email: string }>('select email from accounts where id = $1', [device.accountId]);
  const email = rows[0]?.email?.toLowerCase();
  return Boolean(email && admins().includes(email));
}

/** The email of whoever is acting, for the record of what they did. */
export async function adminEmail(device: Device): Promise<string> {
  const rows = await query<{ email: string }>('select email from accounts where id = $1', [device.accountId]);
  return rows[0]?.email ?? 'unknown';
}

export interface Overview {
  accounts: number;
  plus: number;
  devices: number;
  activeThisMonth: number;
  spend: { kind: string; calls: number; usd: number }[];
  totalUsd: number;
  month: string;
}

/**
 * The numbers worth looking at, for the month so far.
 *
 * Spend is what was actually charged by Anthropic, not counts multiplied by
 * an assumed price — every call has been priced since the benchmark, and now
 * it is kept. That is the difference between knowing whether Plus is priced
 * right and having an opinion about it.
 */
export async function overview(): Promise<Overview> {
  const [counts, spend] = await Promise.all([
    query<{ accounts: string; plus: string; devices: string; active: string }>(
      `select
         (select count(*) from accounts)                                              as accounts,
         (select count(*) from accounts where plus_until > now())                     as plus,
         (select count(*) from devices)                                               as devices,
         (select count(distinct device_id) from usage
           where day >= date_trunc('month', current_date))                            as active`,
    ),
    query<{ kind: string; calls: string; usd: string }>(
      `select kind, sum(count)::text as calls, sum(cost_usd)::text as usd
         from usage
        where day >= date_trunc('month', current_date)
          and kind in ('photo', 'chat', 'recipe')
        group by kind
        order by kind`,
    ),
  ]);

  const rows = spend.map((row) => ({ kind: row.kind, calls: Number(row.calls), usd: Number(row.usd) }));

  return {
    accounts: Number(counts[0].accounts),
    plus: Number(counts[0].plus),
    devices: Number(counts[0].devices),
    activeThisMonth: Number(counts[0].active),
    spend: rows,
    totalUsd: rows.reduce((sum, row) => sum + row.usd, 0),
    month: new Date().toISOString().slice(0, 7),
  };
}

export interface Person {
  id: string;
  email: string;
  verified: boolean;
  plan: Plan;
  plusUntil: string | null;
  joined: string;
  used: Record<string, number>;
  usd: number;
}

/**
 * Everybody, or everybody matching a search.
 *
 * Paged rather than unbounded: a list that works for twenty testers and falls
 * over at ten thousand accounts is a list that will fall over exactly when
 * the app has succeeded.
 */
export async function people(search: string, limit = 50): Promise<Person[]> {
  const like = `%${search.trim().toLowerCase()}%`;
  const rows = await query<{
    id: string;
    email: string;
    verified: boolean;
    plus_until: Date | null;
    created_at: Date;
    photo: string;
    chat: string;
    recipe: string;
    usd: string;
  }>(
    `select a.id, a.email, a.email_verified_at is not null as verified, a.plus_until, a.created_at,
            coalesce(sum(u.count) filter (where u.kind = 'photo'), 0)::text  as photo,
            coalesce(sum(u.count) filter (where u.kind = 'chat'), 0)::text   as chat,
            coalesce(sum(u.count) filter (where u.kind = 'recipe'), 0)::text as recipe,
            coalesce(sum(u.cost_usd), 0)::text                               as usd
       from accounts a
       left join devices d on d.account_id = a.id
       left join usage u on u.device_id = d.id and u.day >= date_trunc('month', current_date)
      where ($1 = '%%' or lower(a.email) like $1)
      group by a.id
      order by a.created_at desc
      limit $2`,
    [like, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    verified: row.verified,
    plan: row.plus_until && row.plus_until > new Date() ? 'plus' : 'free',
    plusUntil: row.plus_until?.toISOString() ?? null,
    joined: row.created_at.toISOString(),
    used: { photo: Number(row.photo), chat: Number(row.chat), recipe: Number(row.recipe) },
    usd: Number(row.usd),
  }));
}

export type PlanChange = { ok: true; plan: Plan; until: string | null } | { ok: false; reason: 'no_account' };

/**
 * Put somebody on Plus, or take them off it.
 *
 * Days from now rather than a date to pick, because every time this is used it
 * is "give them a month" or "give them a year", and a date picker is a way to
 * typo a decade.
 */
export async function setPlan(actor: string, email: string, days: number): Promise<PlanChange> {
  const address = email.trim().toLowerCase();
  const rows = await query<{ id: string; plus_until: Date | null }>(
    days > 0
      ? `update accounts set plus_until = greatest(coalesce(plus_until, now()), now()) + ($2 || ' days')::interval
           where lower(email) = $1 returning id, plus_until`
      : `update accounts set plus_until = null where lower(email) = $1 returning id, plus_until`,
    days > 0 ? [address, String(Math.round(days))] : [address],
  );

  if (!rows.length) return { ok: false, reason: 'no_account' };

  await query('insert into admin_actions (admin, action, subject, detail) values ($1, $2, $3, $4)', [
    actor,
    days > 0 ? 'grant' : 'revoke',
    address,
    days > 0 ? `${Math.round(days)} days` : null,
  ]);

  const until = rows[0].plus_until;
  return { ok: true, plan: until && until > new Date() ? 'plus' : 'free', until: until?.toISOString() ?? null };
}

/** What has been done from here, most recent first. */
export async function actions(limit = 30) {
  const rows = await query<{ admin: string; action: string; subject: string | null; detail: string | null; at: Date }>(
    'select admin, action, subject, detail, at from admin_actions order by at desc limit $1',
    [limit],
  );
  return rows.map((row) => ({ ...row, at: row.at.toISOString() }));
}

/** The allowances in force, so the dashboard shows what is actually running. */
export const allowances = () => ALLOWANCE;
