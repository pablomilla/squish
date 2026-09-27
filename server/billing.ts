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
import { hasDatabase, query } from './db';
import { recordCost } from './identity';
import type { Spend } from './identity';

interface Billed {
  /** Whose it is; null for work nobody's device is waiting on, still counted by model. */
  deviceId: string | null;
  kind: Spend;
}

const store = new AsyncLocalStorage<Billed>();

/** Run a request's handler with somewhere for its costs to land. */
export function billedTo(deviceId: string, kind: Spend, body: () => void): void {
  store.run({ deviceId, kind }, body);
}

/**
 * The same for work that outlives its request — a weekly plan, made in the
 * background and perhaps on another instance after a restart — so it is
 * counted as what it is rather than as whatever request started it.
 */
export function billedAs<T>(kind: Spend, deviceId: string | null, body: () => Promise<T>): Promise<T> {
  return store.run({ deviceId, kind }, body);
}

/**
 * Put a cost against whoever is being served right now, and against the
 * model that did the work.
 *
 * Called from wherever a model response is priced. Outside a request — a
 * script, a test, the eval harness — there is no context and this does
 * nothing, which is what should happen.
 */
export function bill(usd: number | null, model: string): void {
  const who = store.getStore();
  if (!who) return;
  if (who.deviceId) {
    void recordCost(who.deviceId, who.kind, usd).catch(() => {
      /* a gap in a report, never a failed request */
    });
  }
  void recordModelCost(who.kind, model, usd).catch(() => {
    /* the same */
  });
}

/** A call's price against its model and feature, for the dashboard's split by model. */
async function recordModelCost(kind: Spend, model: string, usd: number | null): Promise<void> {
  if (!hasDatabase() || !usd || !Number.isFinite(usd) || usd <= 0) return;
  await query(
    `insert into ai_costs (day, kind, model, calls, cost_usd) values (current_date, $1, $2, 1, $3)
     on conflict (day, kind, model) do update set calls = ai_costs.calls + 1, cost_usd = ai_costs.cost_usd + excluded.cost_usd`,
    [kind, modelName(model), usd.toFixed(6)],
  );
}

/**
 * A model's name without its date stamp, so one model is one line however
 * often its snapshot changes: claude-sonnet-5-20260901 → claude-sonnet-5.
 */
export const modelName = (model: string): string => model.replace(/-\d{8}$/, '').slice(0, 80);
