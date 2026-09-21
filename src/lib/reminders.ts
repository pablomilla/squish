/**
 * Meal reminders, from the phone rather than from a server.
 *
 * This is what the Capacitor wrap was waiting for. The web version needed a
 * server awake at breakfast to push a notification at somebody, which meant
 * VAPID keys, a subscription store, and a free-tier host that goes to sleep
 * and wakes up at eight past eight. None of that exists now: the phone holds
 * the schedule itself, fires on time whether or not Squish is open, and
 * carries on working with no signal at all.
 *
 * On the web it says so rather than pretending. A browser tab cannot do this
 * without the machinery above, and an honest "the app does this" is better
 * than a switch that half works.
 */
import { LocalNotifications, type PermissionStatus } from '@capacitor/local-notifications';
import { isNative } from './origin';

export type ReminderBlocker = 'ok' | 'not-on-web' | 'denied' | 'unavailable';

export interface ReminderTimes {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
}

/**
 * Fixed ids, one per meal.
 *
 * Scheduling over an existing id replaces it, which is what makes changing a
 * time work. Generated ids would leave yesterday's eight o'clock in place
 * beside today's, and a week of that is a phone that pings all morning.
 */
const IDS: Record<keyof ReminderTimes, number> = { breakfast: 1, lunch: 2, dinner: 3 };

/** Said in Squish's voice, because it arrives on a lock screen with its name on it. */
const WORDS: Record<keyof ReminderTimes, { title: string; body: string }> = {
  breakfast: { title: 'Morning', body: 'What did breakfast look like?' },
  lunch: { title: 'Lunchtime', body: 'Worth logging while you remember it.' },
  dinner: { title: 'Evening', body: 'Round the day off — what was dinner?' },
};

/** "08:30" → { hour: 8, minute: 30 }, or nothing if it is not a time. */
function at(time: string | undefined): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** What, if anything, stands in the way. */
export async function reminderSupport(): Promise<ReminderBlocker> {
  if (!isNative()) return 'not-on-web';
  try {
    const { display } = await LocalNotifications.checkPermissions();
    return display === 'denied' ? 'denied' : 'ok';
  } catch {
    return 'unavailable';
  }
}

export function explainBlocker(blocker: ReminderBlocker): string {
  switch (blocker) {
    case 'not-on-web':
      // Not a fault, and not a thing to fix. A web page cannot wake a phone
      // without a server awake at breakfast to do it for them.
      return 'Reminders live in the Squish app on your phone, where they can nudge you without needing a server awake at breakfast.';
    case 'denied':
      return 'Notifications are turned off for Squish. You can allow them again in your phone’s settings.';
    case 'unavailable':
      return 'This device will not let Squish schedule reminders.';
    default:
      return '';
  }
}

export interface EnableResult {
  ok: boolean;
  blocker?: ReminderBlocker;
  message?: string;
}

/**
 * Ask once, then hand the phone the whole week.
 *
 * `on` with only an hour and a minute repeats daily, which is the shape this
 * wants: three standing appointments rather than a queue of one-offs that
 * runs out while somebody is on holiday.
 */
export async function enableReminders(times: ReminderTimes): Promise<EnableResult> {
  const blocker = await reminderSupport();
  if (blocker !== 'ok') return { ok: false, blocker, message: explainBlocker(blocker) };

  let status: PermissionStatus;
  try {
    status = await LocalNotifications.requestPermissions();
  } catch {
    return { ok: false, blocker: 'unavailable', message: explainBlocker('unavailable') };
  }
  if (status.display !== 'granted') {
    return { ok: false, blocker: 'denied', message: 'Reminders need permission to show notifications.' };
  }

  const meals = (Object.keys(IDS) as (keyof ReminderTimes)[]).filter((meal) => at(times[meal]));
  if (!meals.length) return { ok: false, message: 'Set a time for at least one meal first.' };

  try {
    // Clear first: a meal whose time was removed should stop, and scheduling
    // alone would never tell the phone that.
    await disableReminders();
    await LocalNotifications.schedule({
      notifications: meals.map((meal) => ({
        id: IDS[meal],
        title: WORDS[meal].title,
        body: WORDS[meal].body,
        schedule: { on: at(times[meal]) ?? undefined, allowWhileIdle: true },
      })),
    });
    return { ok: true };
  } catch {
    return { ok: false, message: 'Reminders could not be set up. Try again in a moment.' };
  }
}

/** Stop the lot. Safe to call when none are set. */
export async function disableReminders(): Promise<void> {
  if (!isNative()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const ours = pending.notifications.filter((n) => Object.values(IDS).includes(n.id));
    if (ours.length) await LocalNotifications.cancel({ notifications: ours.map(({ id }) => ({ id })) });
  } catch {
    // Nothing useful to say: they are off at our end either way.
  }
}
