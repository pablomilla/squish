/**
 * What the paid tier is called, in the one place that decides it.
 *
 * This file used to answer "is this person subscribed?" with a hardcoded
 * false, and carried the rules for doing it properly one day. That day came:
 * the answer now comes from the server, in `lib/plan.ts`, and the rules it
 * set out are kept there —
 *
 * 1. **Never from localStorage.** A persisted `subscribed: true` is a line in
 *    a file anybody can edit.
 * 2. **Fail closed on the money, open on the person.** A check that cannot be
 *    made hands out nothing unpaid, and takes nothing away either.
 *
 * What is left here is the name, which both the app and the server import so
 * that renaming the tier is one edit rather than a search.
 */
export const PLUS = 'Squish Plus';
