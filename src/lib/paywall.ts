/**
 * Announcing that somebody has run into the end of their allowance.
 *
 * An emitter rather than a prop threaded through every screen, because the
 * wall can be hit from three places — a photo, a question, a recipe — and the
 * thing that knows first is the API client, not the screen that called it.
 * Putting it here means no screen can forget: anything that goes through
 * `lib/api.ts` raises it for free.
 *
 * It carries what the server said rather than a boolean, because the sentence
 * differs by tier. Somebody on the free plan has somewhere to go. Somebody
 * already paying does not, and telling them to upgrade would be both useless
 * and insulting.
 */
import type { OutOfAllowance } from './api';

let listener: ((standing: OutOfAllowance) => void) | null = null;

export function onPaywall(handler: ((standing: OutOfAllowance) => void) | null): void {
  listener = handler;
}

export function showPaywall(standing: OutOfAllowance): void {
  listener?.(standing);
}
