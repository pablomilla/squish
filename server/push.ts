/**
 * Meal reminders.
 *
 * An untracked day is a lost user, so this is the least glamorous feature here
 * and probably the one that decides whether anybody keeps using the app. It is
 * also the one the web makes hardest.
 *
 * There is no way for a web app to schedule a notification for later on the
 * device: the Notification Triggers API never shipped anywhere, and a timer in
 * a page dies with the page. The only thing that actually reaches somebody who
 * is not looking at the app is a push from a server. So there is a server-side
 * clock here, and it is the first piece of state this app has ever kept.
 *
 * What that state is, exactly, matters. Squish keeps everything else in the
 * browser, and this does not change that. A subscription here holds:
 *
 *   - the push endpoint the browser gave us, and its keys
 *   - what times of day to nudge, and which meals
 *   - an IANA timezone, so 8am means 8am where the person is
 *
 * It does not hold food, weight, a name, an email, or anything that would
 * identify whose diary it is. The endpoint is an opaque URL from the browser
 * vendor, and it is all we need.
 *
 * When the app is wrapped for the App Store this file becomes unnecessary:
 * a native local notification is scheduled on the device, needs no server, no
 * keys, and no subscription at all. This is the web's version of a job that
 * the phone does properly.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import webpush from 'web-push';

/** The meals worth a nudge. Snacks are not a thing anyone forgets. */
export const REMINDER_MEALS = ['breakfast', 'lunch', 'dinner'] as const;
export type ReminderMeal = (typeof REMINDER_MEALS)[number];

export interface ReminderTimes {
  /** "08:00", or absent for a meal they do not want nudging about. */
  breakfast?: string;
  lunch?: string;
  dinner?: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  times: ReminderTimes;
  /** An IANA name — "Europe/London" — so the clock follows them, and so does DST. */
  timezone: string;
  /** Local dates a given meal was last sent on, to send once a day and no more. */
  sent: Partial<Record<ReminderMeal, string>>;
}

/* ------------------------------------------------------------------ *
 * Configuration.
 * ------------------------------------------------------------------ */

const STORE_PATH = resolve(process.env.SQUISH_PUSH_STORE ?? '.data/push-subscriptions.json');

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function publicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

let configured = false;

function configure(): void {
  if (configured || !pushConfigured()) return;
  webpush.setVapidDetails(
    // A contact for the push service to reach if we misbehave. Their own
    // address where they set one, ours otherwise — never a user's.
    process.env.VAPID_SUBJECT ?? 'https://github.com/pablomilla/squish',
    process.env.VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );
  configured = true;
}

/* ------------------------------------------------------------------ *
 * The store. A file, deliberately: this is a handful of rows and adding
 * a database to an app with no accounts would be the tail wagging the dog.
 * ------------------------------------------------------------------ */

let cache: Map<string, PushSubscriptionRecord> | null = null;

function load(): Map<string, PushSubscriptionRecord> {
  if (cache) return cache;
  cache = new Map();
  try {
    const rows = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as PushSubscriptionRecord[];
    for (const row of rows) if (row?.endpoint) cache.set(row.endpoint, row);
  } catch {
    // No file yet, or an unreadable one. Either way we start empty rather than
    // refusing to boot over a reminder list.
  }
  return cache;
}

function save(): void {
  const rows = [...load().values()];
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(rows, null, 2));
  } catch {
    // A host with a read-only or ephemeral disk loses reminders on restart,
    // which is worth knowing about but not worth a crash.
  }
}

export function subscribe(record: Omit<PushSubscriptionRecord, 'sent'>): void {
  const store = load();
  const existing = store.get(record.endpoint);
  store.set(record.endpoint, { ...record, sent: existing?.sent ?? {} });
  save();
}

export function unsubscribe(endpoint: string): void {
  if (load().delete(endpoint)) save();
}

export function subscriptionCount(): number {
  return load().size;
}

/** Test seam. */
export function resetPushStore(): void {
  cache = new Map();
}

/* ------------------------------------------------------------------ *
 * The clock.
 * ------------------------------------------------------------------ */

/** Local wall-clock time and date in a given zone, as plain strings. */
export function localNow(timezone: string, at = new Date()): { time: string; date: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false,
    }).formatToParts(at);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    // Some engines render midnight as 24; the ISO day has rolled by then.
    const hour = get('hour') === '24' ? '00' : get('hour');
    return { time: `${hour}:${get('minute')}`, date: `${get('year')}-${get('month')}-${get('day')}` };
  } catch {
    // An unknown zone should not stop everyone else's reminders.
    return { time: '', date: '' };
  }
}

export interface DueReminder {
  endpoint: string;
  meal: ReminderMeal;
  date: string;
}

/**
 * Which reminders are due right now.
 *
 * A minute is either the minute or it is not — there is no catching up on a
 * missed one. A reminder that arrives an hour late is worse than no reminder,
 * because the only thing it can tell you is that the app is broken.
 */
export function dueNow(records: Iterable<PushSubscriptionRecord>, at = new Date()): DueReminder[] {
  const due: DueReminder[] = [];

  for (const record of records) {
    const { time, date } = localNow(record.timezone, at);
    if (!time) continue;

    for (const meal of REMINDER_MEALS) {
      if (record.times[meal] !== time) continue;
      if (record.sent[meal] === date) continue; // Once a day is plenty.
      due.push({ endpoint: record.endpoint, meal, date });
    }
  }

  return due;
}

const WORDS: Record<ReminderMeal, { title: string; body: string }> = {
  breakfast: { title: 'Morning!', body: 'Had breakfast? Squish is ready when you are.' },
  lunch: { title: 'Lunchtime', body: "Pop your lunch in while you remember it." },
  dinner: { title: 'Evening', body: 'Dinner logged? It only takes a photo.' },
};

/* ------------------------------------------------------------------ *
 * Sending.
 * ------------------------------------------------------------------ */

async function send(record: PushSubscriptionRecord, meal: ReminderMeal): Promise<boolean> {
  configure();
  const words = WORDS[meal];

  try {
    await webpush.sendNotification(
      { endpoint: record.endpoint, keys: record.keys },
      JSON.stringify({ meal, title: words.title, body: words.body }),
      { TTL: 1800 }, // Half an hour. After that the moment has passed.
    );
    return true;
  } catch (error) {
    // 404 and 410 mean the browser threw the subscription away — the app was
    // uninstalled, or notifications were turned off. Stop writing to it.
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      unsubscribe(record.endpoint);
      return false;
    }
    // Anything else is worth seeing. A reminder clock that fails silently is
    // one nobody discovers is broken until users start leaving.
    console.error(`[push] ${meal} reminder failed${status ? ` (${status})` : ''}:`, (error as Error).message);
    return false;
  }
}

/** One tick. Exported so a test can run it without waiting for a minute. */
export async function runReminders(at = new Date()): Promise<number> {
  if (!pushConfigured()) return 0;

  const store = load();
  const due = dueNow(store.values(), at);
  let sent = 0;

  for (const item of due) {
    const record = store.get(item.endpoint);
    if (!record) continue;
    // Marked before sending, not after: a push service that is slow or down
    // must not turn one reminder into a tick-every-minute apology.
    record.sent[item.meal] = item.date;
    if (await send(record, item.meal)) sent += 1;
  }

  if (due.length) save();
  return sent;
}

let timer: NodeJS.Timeout | null = null;

/** Start the minute clock. Does nothing without keys, which is the usual case. */
export function startReminderClock(): void {
  if (timer || !pushConfigured()) return;
  timer = setInterval(() => {
    void runReminders();
  }, 60_000);
  timer.unref?.(); // Never the reason a process refuses to exit.
}

export function stopReminderClock(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
