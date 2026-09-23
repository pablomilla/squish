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
/* ---------------- Arriving from the old address ---------------- */

/**
 * `#handoff=…`: this browser has just been sent here from squish.online, the
 * app's old address, carrying a code for the device it was there.
 */
function handoffInUrl(): string | null {
  try {
    return /(?:^#|&)handoff=([A-Za-z0-9_-]{16,100})/.exec(location.hash)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Whether this address already has a diary of its own, which a handoff must not replace. */
function hasOwnDiary(): boolean {
  try {
    const stored = JSON.parse(localStorage.getItem('squish-v1') ?? 'null') as {
      state?: { profile?: { onboarded?: boolean } };
    } | null;
    return stored?.state?.profile?.onboarded === true;
  } catch {
    return false;
  }
}

export type Handoff = 'none' | 'arrived' | 'kept' | 'expired';

let handoff: Promise<Handoff> | null = null;

/**
 * Claim the code, before anything else asks who this browser is.
 *
 * Started from main.tsx before the first render, and awaited by
 * deviceToken(), so nothing registers a brand-new device while the old one
 * is on its way. The code is taken out of the address bar straight away so a
 * reload or a shared link cannot try it twice.
 *
 * Where this address already holds a diary, nothing is claimed: two diaries
 * are not merged by machine anywhere in Squish, and this is no exception.
 */
export function arriveFromOldAddress(origin: (path: string) => string): Promise<Handoff> {
  handoff ??= (async (): Promise<Handoff> => {
    const code = handoffInUrl();
    if (!code) return 'none';
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* nothing to do */
    }
    if (hasOwnDiary()) return 'kept';
    try {
      const response = await fetch(origin('/api/device/claim'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) return 'expired';
      const made = (await response.json()) as Registration;
      if (!made?.token) return 'expired';
      remember(made);
      return 'arrived';
    } catch {
      return 'expired';
    }
  })();
  return handoff;
}

export async function deviceToken(origin: (path: string) => string): Promise<string | null> {
  if (handoff) await handoff;
  const saved = remembered();
  if (saved) return saved.token;

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
