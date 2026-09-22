/**
 * Attributing what a call cost to the person who made it.
 *
 * The price of every model call has been worked out since the benchmark was
 * written and then dropped into a log line. Keeping it is what turns the
 * costings in docs/monetisation.md from a guess into a measurement — and
 * "is Plus priced right?" is not a question to answer with an opinion.
 *
 * Done with an async context rather than by passing a device id down through
 * analysePhoto, analyseText, requestMeal and the chat loop. Those signatures
 * are about food, not bookkeeping, and five of them would have had to grow a
 * parameter that none of them uses.
 *
 * Nothing here is ever awaited by a request and nothing here can fail one. A
 * missing price is a gap in a report; a failed analysis because the
 * bookkeeping fell over would be somebody's lunch.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { recordCost } from './identity';
import type { Spend } from './identity';

interface Billed {
  deviceId: string;
  kind: Spend;
}

const store = new AsyncLocalStorage<Billed>();

/** Run a request's handler with somewhere for its costs to land. */
export function billedTo(deviceId: string, kind: Spend, body: () => void): void {
  store.run({ deviceId, kind }, body);
}

/**
 * Put a cost against whoever is being served right now.
 *
 * Called from wherever a model response is priced. Outside a request — a
 * script, a test, the eval harness — there is no context and this does
 * nothing, which is what should happen.
 */
export function bill(usd: number | null): void {
  const who = store.getStore();
  if (!who) return;
  void recordCost(who.deviceId, who.kind, usd).catch(() => {
    /* a gap in a report, never a failed request */
  });
}
