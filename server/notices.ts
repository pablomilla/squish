/**
 * Telling somebody when something happens to their account.
 *
 * This is how account takeover actually gets noticed. Not by the person
 * checking a list of sessions — nobody does — but by an email arriving that
 * says "you signed in on Chrome on Windows" to somebody who owns a Mac.
 *
 * Two rules, both about not becoming a nuisance or a weapon:
 *
 * 1. **Only to a confirmed address.** Otherwise anybody could sign up as a
 *    stranger and have Squish send them a stream of mail about an account
 *    they never made.
 * 2. **Never at the expense of the thing that happened.** By the time a notice
 *    is sent, the sign-in or the password change has already succeeded, and a
 *    mail provider having a bad minute must not turn that into an error.
 */
import { query } from './db';
import { sendQuietly } from './mail';
import { compose } from './emails';

/**
 * "Safari on iPhone", from a user-agent string.
 *
 * Deliberately coarse. Enough for somebody to say "that was me" or "I do not
 * own a Windows computer", and nothing that would identify a person or a
 * machine — this goes into an email, and emails get forwarded.
 */
export function describeDevice(userAgent: string | undefined): string {
  const ua = userAgent ?? '';

  const system =
    /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux'
    : null;

  // Order matters: every Chromium browser also says "Chrome", and Chrome on
  // iOS says "Safari" as well as "CriOS".
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null;

  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'an unrecognised device';
}

/** When, the way a person reads a time. */
function when(now = new Date()): string {
  return `${now.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })} (UK time)`;
}

async function confirmedAddress(accountId: string): Promise<string | null> {
  const rows = await query<{ email: string }>(
    'select email from accounts where id = $1 and email_verified_at is not null',
    [accountId],
  );
  return rows[0]?.email ?? null;
}

export async function noticeSignIn(accountId: string, userAgent: string | undefined, origin: string): Promise<void> {
  const to = await confirmedAddress(accountId);
  if (!to) return;
  sendQuietly(await compose('signin', to, { device: describeDevice(userAgent), time: when(), app_link: origin }, origin), 'sign-in notice');
}

export async function noticePasswordChanged(accountId: string, how: 'changed' | 'reset', origin: string): Promise<void> {
  const to = await confirmedAddress(accountId);
  if (!to) return;
  sendQuietly(
    await compose(how === 'reset' ? 'password-reset' : 'password-changed', to, { time: when(), app_link: origin }, origin),
    'password notice',
  );
}
