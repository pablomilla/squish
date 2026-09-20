/**
 * Turning meal reminders on, from the browser's side.
 *
 * The awkward shape of this is the platform's, not ours. Three things have to
 * line up — a service worker, notification permission, and a push
 * subscription — and each of them can be missing for a different reason, so
 * `reminderSupport()` reports which one rather than a single yes or no. A
 * screen that says "reminders are unavailable" and nothing else is no use to
 * anybody.
 *
 * The iPhone case is worth stating plainly, because it will be most of your
 * users: Safari only allows notifications to a web app that has been added to
 * the home screen, from iOS 16.4. In a normal Safari tab there is no
 * PushManager at all, and no amount of asking will produce one.
 */

export type ReminderBlocker =
  | 'ok'
  | 'no-service-worker'
  | 'no-push'
  | 'needs-home-screen'
  | 'denied'
  | 'not-configured';

export interface ReminderTimes {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
}

/** True when the page is running as an installed app rather than in a tab. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = (window.navigator as { standalone?: boolean }).standalone;
  return standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

const isApple = (): boolean =>
  typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** What, if anything, is standing in the way. */
export function reminderSupport(): ReminderBlocker {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'no-service-worker';
  if (!('PushManager' in window) || !('Notification' in window)) {
    // On an iPhone the missing PushManager is almost always the home-screen
    // rule rather than an old browser, and saying so is actionable.
    return isApple() && !isInstalled() ? 'needs-home-screen' : 'no-push';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

/**
 * Whether this server can send reminders at all.
 *
 * The browser being capable is only half of it: without a keypair on the
 * server there is nothing to subscribe to. Asked up front rather than
 * discovered by pressing a button, because a control that only fails when
 * used looks like a fault rather than a decision.
 */
export async function pushConfigured(): Promise<boolean> {
  try {
    const response = await fetch('/api/push/key');
    if (!response.ok) return false;
    return Boolean(((await response.json()) as { publicKey?: string }).publicKey);
  } catch {
    return false;
  }
}

export function explainBlocker(blocker: ReminderBlocker): string {
  switch (blocker) {
    case 'needs-home-screen':
      return 'On an iPhone, reminders only work once Squish is on your home screen. Tap Share, then "Add to Home Screen", and come back.';
    case 'no-push':
      return 'This browser cannot send reminders. Chrome, Edge and Safari can.';
    case 'no-service-worker':
      return 'This browser cannot send reminders.';
    case 'denied':
      return 'Notifications are blocked for Squish. You can allow them again in your browser settings.';
    case 'not-configured':
      // Not a fault. Waking a phone from a web page needs a server that never
      // sleeps; the app on the phone will do it on the device instead.
      return 'Reminders are waiting on the phone app — it can nudge you without needing a server awake at breakfast.';
    default:
      return '';
  }
}

/** The browser's own base64url, which is not the one `atob` wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function ready(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

export interface EnableResult {
  ok: boolean;
  blocker?: ReminderBlocker;
  message?: string;
}

/**
 * Ask for permission, subscribe, and tell the server when to nudge.
 *
 * The permission prompt only ever appears from here, which is to say from a
 * button somebody pressed. Asking on page load is the single fastest way to
 * get told no for ever, and "denied" is not a decision a website can revisit.
 */
export async function enableReminders(times: ReminderTimes): Promise<EnableResult> {
  const blocker = reminderSupport();
  if (blocker !== 'ok') return { ok: false, blocker, message: explainBlocker(blocker) };

  let key: string;
  try {
    const response = await fetch('/api/push/key');
    if (!response.ok) return { ok: false, blocker: 'not-configured', message: explainBlocker('not-configured') };
    key = ((await response.json()) as { publicKey: string }).publicKey;
    if (!key) return { ok: false, blocker: 'not-configured', message: explainBlocker('not-configured') };
  } catch {
    return { ok: false, message: 'Could not reach Squish to set reminders up.' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, blocker: 'denied', message: 'Reminders need permission to show notifications.' };
  }

  try {
    const registration = await ready();
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Silent pushes are not allowed on the web, and trying gets a site's
        // permission revoked. Everything we send is something to show.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      }));

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        times,
        // An IANA name rather than an offset, so the clock survives the spring.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });

    return { ok: true };
  } catch {
    return { ok: false, message: 'Reminders could not be set up. Try again in a moment.' };
  }
}

/** Stop reminders, and tell the server to forget the subscription. */
export async function disableReminders(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  } catch {
    // Nothing useful to say: the reminders are off at our end either way.
  }
}
