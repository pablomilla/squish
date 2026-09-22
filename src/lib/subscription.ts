/**
 * Whether this person is on Squish Plus.
 *
 * False, always, for now — there is no way to buy it yet. It exists as a
 * function rather than a constant so that everything which depends on a
 * subscription can be built, seen and tested before there is anything to
 * subscribe to, and switching it on later is one file rather than a feature.
 *
 * When it does become real, two rules matter more than the plumbing:
 *
 * 1. **Never from localStorage.** A persisted `subscribed: true` is a line in
 *    a file anybody can edit, and a paywall that a devtools console defeats is
 *    a paywall that funds nothing. The answer has to come from a receipt the
 *    store signed — via RevenueCat, or verified against Apple and Google on
 *    our own server — and it has to be re-checked, because subscriptions
 *    lapse.
 * 2. **Fail closed on the money, open on the person.** If the check cannot be
 *    made, do not hand out what has not been paid for — but do not take away
 *    anything somebody already has either. A diary must never become
 *    unreadable because a receipt server was down; the worst a failed check
 *    should do is put a colourway back in its box.
 *
 * The plan this belongs to is in docs/monetisation.md.
 */

export function isSubscribed(): boolean {
  return false;
}

/** What the tier is called, in the one place that decides it. */
export const PLUS = 'Squish Plus';
