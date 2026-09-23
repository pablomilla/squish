/**
 * Who sent this person, if anyone: the code from an affiliate's link.
 *
 * squish.online/r/CODE arrives here as ?ref=CODE. The code is kept in this
 * browser for 30 days — long enough for somebody to come back and make an
 * account another day — and handed over once, with the sign-up. It is taken
 * out of the address straight away, so it is not bookmarked or shared on.
 *
 * Nothing else is kept: not when they came, not from where. The code only
 * ever says which affiliate to credit.
 */
const KEY = 'squish-ref';
const DAYS = 30;

interface Stored {
  code: string;
  at: number;
}

/** Read ?ref= from the address, if there is one, and remember it. */
export function catchReferral(): void {
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('ref')?.trim().toUpperCase();
    if (!code) return;
    url.searchParams.delete('ref');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (!/^[A-Z0-9-]{3,24}$/.test(code)) return;
    // The first link wins, as it does on the server: a second click on
    // somebody else's link does not take the credit from whoever sent them.
    if (referral()) return;
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() } satisfies Stored));
  } catch {
    // Private windows and blocked storage: nobody gets credited, nothing breaks.
  }
}

/** The code this browser arrived with, while it is still fresh. */
export function referral(): string | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (!stored || typeof stored.code !== 'string') return undefined;
    if (Date.now() - stored.at > DAYS * 86_400_000) {
      localStorage.removeItem(KEY);
      return undefined;
    }
    return stored.code;
  } catch {
    return undefined;
  }
}

/** Once an account has been made, the code has done its job. */
export function forgetReferral(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
