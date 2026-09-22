/**
 * Refusing passwords that are already in somebody's breach dump.
 *
 * The realistic attack on an app like this is not somebody who wants to read
 * your lunch. It is credential stuffing: bulk-testing addresses and passwords
 * leaked from other sites, because most people reuse them. Rate limiting slows
 * that down; this stops the ones that would have worked.
 *
 * It is done through Have I Been Pwned's range API, which is built so that
 * the password never leaves and neither does anything that identifies it.
 * We SHA-1 the password, send the **first five characters of the hash**, and
 * get back every suffix they hold beginning with those five — some hundreds of
 * them — and look for ours in the list. They learn that somebody, somewhere,
 * asked about one of half a million possible passwords. That is all.
 *
 * **It fails open, deliberately.** If the check cannot be made — their service
 * is down, the network is out, a timeout — the password is allowed. A security
 * measure that takes sign-up down when a third party has a bad afternoon is a
 * worse outcome than the one it was guarding against.
 */
import { createHash } from 'node:crypto';

/*
 * Read when used rather than when the module loads.
 *
 * A constant captured at import time cannot be changed without a restart,
 * and cannot be pointed at a stand-in by a test that imported the module a
 * moment earlier — which is exactly how the first version of this failed.
 */
const endpoint = (): string => process.env.SQUISH_PWNED_API?.trim() || 'https://api.pwnedpasswords.com/range';

/** Short. Nobody should wait on this to find out whether they can sign up. */
const timeout = (): number => Number(process.env.SQUISH_PWNED_TIMEOUT_MS ?? 2500);

/** Off where somebody has deliberately turned it off, and in most tests. */
export const checkingPasswords = (): boolean => process.env.SQUISH_PWNED_API !== 'off';

/**
 * How many times this password appears in known breaches. Zero means unknown
 * to them, which is the answer we want; null means we could not ask.
 */
export async function timesBreached(password: string): Promise<number | null> {
  if (!checkingPasswords()) return 0;

  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const response = await fetch(`${endpoint()}/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'Squish' },
      signal: AbortSignal.timeout(timeout()),
    });
    if (!response.ok) return null;

    for (const line of (await response.text()).split('\n')) {
      const [found, count] = line.trim().split(':');
      if (found === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    // Failing open: see the note at the top. Never let this stop a sign-up.
    return null;
  }
}

/**
 * How often a password has to appear before it is worth refusing.
 *
 * One appearance is enough. A password in any dump is a password in the
 * dictionary every stuffing tool ships with, and "it was only breached
 * twice" is not a defence.
 */
const TOO_MANY = 1;

export interface PasswordVerdict {
  ok: boolean;
  /** Null where we could not ask, which is not the same as zero. */
  breaches: number | null;
  message?: string;
}

export async function judgePassword(password: string): Promise<PasswordVerdict> {
  const breaches = await timesBreached(password);
  if (breaches === null || breaches < TOO_MANY) return { ok: true, breaches };

  return {
    ok: false,
    breaches,
    // Said without blame. They did not necessarily choose badly — somebody
    // else's website lost it — and the number is what makes that land.
    message:
      breaches > 1000
        ? `That password has turned up in ${breaches.toLocaleString()} known breaches, which makes it one of the first an attacker tries. Please pick another — somebody else's website lost it, and nothing you did was wrong.`
        : "That password has appeared in a known data breach, which makes it one of the first an attacker tries. Please pick another — somebody else's website lost it, and nothing you did was wrong.",
  };
}
