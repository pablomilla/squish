/**
 * This browser's name for itself.
 *
 * Fetched once, kept for ever, sent with everything. There is nothing for
 * anybody to fill in: the first request that needs it asks the server for a
 * token, and every request after carries it. It is what lets a rate limit be
 * about a device instead of about an IP address shared by everybody on the
 * same mobile network, and it is where a diary backup and an account will
 * later hang.
 *
 * Every failure here is quiet and every one leaves the app working. A server
 * with no database says so, an offline browser cannot ask, and private
 * browsing forgets the answer — in all three cases Squish carries on exactly
 * as it did before any of this existed, which is the whole design.
 */
const KEY = 'squish-device';

interface Registration {
  id: string;
  token: string;
}

let pending: Promise<string | null> | null = null;

function remembered(): Registration | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Registration;
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

function remember(registration: Registration): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(registration));
  } catch {
    /* private browsing — a new token every session, which still works */
  }
}

/** Thrown away when the server says it has never heard of us. */
export function forgetDevice(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
  pending = null;
}

/**
 * The token, asking for one if this browser has not got one.
 *
 * The promise is cached rather than the result, so ten calls made at once
 * during a cold start register one device rather than ten.
 */
export function deviceToken(origin: (path: string) => string): Promise<string | null> {
  const saved = remembered();
  if (saved) return Promise.resolve(saved.token);

  pending ??= (async () => {
    try {
      const response = await fetch(origin('/api/device'), { method: 'POST' });
      if (!response.ok) return null;
      const made = (await response.json()) as Registration;
      if (!made?.token) return null;
      remember(made);
      return made.token;
    } catch {
      return null;
    } finally {
      // Cleared either way: a failure now should not stop the next attempt,
      // and a success is in localStorage where the next call will find it.
      pending = null;
    }
  })();

  return pending;
}
