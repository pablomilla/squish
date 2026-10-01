/**
 * Two copies of one diary made into one: the phone's and the iPad's.
 *
 * The diary is saved to the account as a whole, and the server only takes a
 * save from a device that has seen the latest one. When two devices have both
 * changed things since they last agreed, the one saving second is told so and
 * handed the other's copy — and this is what puts the two together, so both
 * devices end up with everything rather than somebody having to choose.
 *
 * It is not a guess about food. Every meal, plan, recipe and shopping line
 * has an id of its own, so a lunch logged on each device is two entries,
 * whatever they are called; the same entry changed on both is the later
 * change. The diary is looked at as its parts:
 *
 * - lists of things with ids (meals, plans, recipes…), one part per thing;
 * - records by key (each day's water and steps, each badge earned);
 * - sets of words (meals that are not for them, shopping lines ticked);
 * - settings, one part per field (the profile's weight and its language are
 *   two parts, so changing each on a different device keeps both).
 *
 * Beside the diary goes when each part last changed, and when it went
 * (`SyncTimes`): a part deleted on one device stays deleted, unless the other
 * changed it again afterwards. The times are found by comparing the diary
 * with what it was the last time it was looked at (`stamp`), so nothing that
 * changes the diary has to remember to say so.
 *
 * Pure, so it runs in the tests as it runs in the app.
 */

/** When each part of the diary last changed, by part: its time, a fingerprint of it, and whether it has gone. */
export type SyncTimes = Record<string, { t: number; h: string; gone?: 1 }>;

type Shape =
  | { kind: 'list'; key: (item: Record<string, unknown>) => string }
  | { kind: 'record' }
  | { kind: 'set' }
  | { kind: 'fields' }
  | { kind: 'value' }
  | { kind: 'object'; parts: Record<string, Shape> };

const byId: Shape = { kind: 'list', key: (item) => (typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : '') };
const record: Shape = { kind: 'record' };
const set: Shape = { kind: 'set' };
const fields: Shape = { kind: 'fields' };
const value: Shape = { kind: 'value' };

/** How each part of the diary is made of parts. Anything not named is one part, whole. */
export const SHAPES: Record<string, Shape> = {
  meals: byId,
  plans: byId,
  favourites: byId,
  recipes: byId,
  nutritionistNotes: byId,
  // A plan's outcome has no id: the meal it was, on its day, is what it is.
  planLog: { kind: 'list', key: (item) => `${String(item.date)}#${String(item.slot)}#${String(item.title)}` },
  days: record,
  unlocked: record,
  chatsGone: record,
  notForMe: set,
  shopping: { kind: 'object', parts: { ticked: set, extras: byId } },
  profile: fields,
  targets: fields,
  household: fields,
  outfit: fields,
  shareDecor: fields,
};

/** Kept beside the diary rather than merged as part of it. */
const OUTSIDE = new Set(['_sync', 'pastChats']);

/** How long a deletion is remembered: longer than any device is likely to go without opening Squish. */
export const GONE_FOR_MS = 120 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Parts.
 * ------------------------------------------------------------------ */

/** JSON with its keys in order, so the same thing has the same fingerprint on every device. */
export function stableJson(input: unknown): string {
  if (input === undefined) return 'null';
  if (input === null || typeof input !== 'object') return JSON.stringify(input) ?? 'null';
  if (Array.isArray(input)) return `[${input.map(stableJson).join(',')}]`;
  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

/** A thing's fingerprint, whatever order its keys were written in: for what is kept outside the parts. */
export const fingerprintOf = (thing: unknown): string => fingerprint(stableJson(thing));

/** A short fingerprint: enough to tell whether a part has changed. */
function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}${text.length.toString(36)}`;
}

/** Between a part's container and its own key: a character no id or date uses. */
const SEP = '\u0001';

/** A diary as its parts, in order, by `path SEP key`. */
function partsOf(diary: Record<string, unknown>): Map<string, unknown> {
  const parts = new Map<string, unknown>();
  const add = (path: string, shape: Shape, held: unknown) => {
    if (held === undefined) return;
    switch (shape.kind) {
      case 'list': {
        if (!Array.isArray(held)) {
          parts.set(`${path}${SEP}`, held);
          return;
        }
        const seen = new Map<string, number>();
        for (const item of held) {
          const own = item && typeof item === 'object' ? shape.key(item as Record<string, unknown>) : '';
          let key = own || `~${fingerprint(stableJson(item))}`;
          // Two with one id are kept as two, rather than one quietly lost.
          const n = seen.get(key) ?? 0;
          seen.set(key, n + 1);
          if (n) key = `${key}#${n}`;
          parts.set(`${path}${SEP}${key}`, item);
        }
        return;
      }
      case 'set':
        if (!Array.isArray(held)) {
          parts.set(`${path}${SEP}`, held);
          return;
        }
        for (const word of held) parts.set(`${path}${SEP}${typeof word === 'string' ? word : stableJson(word)}`, word);
        return;
      case 'record':
      case 'fields':
        if (!held || typeof held !== 'object' || Array.isArray(held)) {
          parts.set(`${path}${SEP}`, held);
          return;
        }
        for (const [key, inner] of Object.entries(held)) if (inner !== undefined) parts.set(`${path}${SEP}${key}`, inner);
        return;
      case 'object':
        if (!held || typeof held !== 'object' || Array.isArray(held)) {
          parts.set(`${path}${SEP}`, held);
          return;
        }
        for (const [name, inner] of Object.entries(shape.parts)) add(`${path}.${name}`, inner, (held as Record<string, unknown>)[name]);
        return;
      default:
        parts.set(`${path}${SEP}`, held);
    }
  };
  for (const [name, held] of Object.entries(diary)) {
    if (OUTSIDE.has(name)) continue;
    add(name, SHAPES[name] ?? value, held);
  }
  return parts;
}

/** The containers a diary has, so an emptied list comes back empty rather than missing. */
function containersOf(diary: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(diary).filter((name) => !OUTSIDE.has(name) && diary[name] !== undefined));
}

/** Parts back into a diary, for the containers given. */
function diaryFrom(parts: Map<string, unknown>, containers: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const empty = (shape: Shape): unknown => {
    switch (shape.kind) {
      case 'list':
      case 'set':
        return [];
      case 'record':
      case 'fields':
        return {};
      case 'object':
        return Object.fromEntries(Object.entries(shape.parts).map(([name, inner]) => [name, empty(inner)]));
      default:
        return undefined;
    }
  };
  for (const name of containers) {
    const shape = SHAPES[name] ?? value;
    const start = empty(shape);
    if (start !== undefined) out[name] = start;
  }
  for (const [part, held] of parts) {
    const at = part.indexOf(SEP);
    const path = part.slice(0, at);
    const key = part.slice(at + 1);
    const [name, inner] = path.split('.') as [string, string | undefined];
    if (!containers.has(name)) continue;
    const shape = SHAPES[name] ?? value;
    const innerShape: Shape = (inner && shape.kind === 'object' ? shape.parts[inner] : shape) ?? value;
    if (inner && (!out[name] || typeof out[name] !== 'object' || Array.isArray(out[name]))) out[name] = {};
    const holder = inner ? (out[name] as Record<string, unknown>) : out;
    const slot = inner ?? name;
    // The whole thing: one part by design, or not the shape it was meant to be.
    if (key === '') {
      holder[slot] = held;
      continue;
    }
    switch (innerShape.kind) {
      case 'list':
      case 'set':
        if (!Array.isArray(holder[slot])) holder[slot] = [];
        (holder[slot] as unknown[]).push(held);
        break;
      default:
        if (!holder[slot] || typeof holder[slot] !== 'object' || Array.isArray(holder[slot])) holder[slot] = {};
        (holder[slot] as Record<string, unknown>)[key] = held;
    }
  }
  return out;
}

/** The container a part belongs to. */
const containerOf = (part: string) => part.slice(0, part.indexOf(SEP)).split('.')[0];

/* ------------------------------------------------------------------ *
 * Times.
 * ------------------------------------------------------------------ */

/**
 * What has changed since the diary was last looked at: each part new or
 * different is stamped `now`, and each part gone since is stamped gone. Only
 * the containers this diary has are looked at, so a part of the diary not
 * sent (past chats, where they are not backed up) is not taken for deleted.
 */
export function stamp(diary: Record<string, unknown>, times: SyncTimes, now: number): { times: SyncTimes; changed: boolean } {
  const parts = partsOf(diary);
  const containers = containersOf(diary);
  const next: SyncTimes = { ...times };
  let changed = false;
  for (const [part, held] of parts) {
    const h = fingerprint(stableJson(held));
    const was = times[part];
    if (!was || was.gone || was.h !== h) {
      next[part] = { t: now, h };
      changed = true;
    }
  }
  for (const [part, was] of Object.entries(times)) {
    if (was.gone || parts.has(part) || !containers.has(containerOf(part))) continue;
    next[part] = { t: now, h: '', gone: 1 };
    changed = true;
  }
  return { times: changed ? next : times, changed };
}

/** Deletions older than anybody needs to hear about, let go. */
export function prune(times: SyncTimes, now: number): SyncTimes {
  const kept = Object.entries(times).filter(([, entry]) => !entry.gone || now - entry.t < GONE_FOR_MS);
  return kept.length === Object.keys(times).length ? times : Object.fromEntries(kept);
}

/* ------------------------------------------------------------------ *
 * The merge.
 * ------------------------------------------------------------------ */

export interface Merged {
  diary: Record<string, unknown>;
  times: SyncTimes;
  /** How many parts came from the other copy, and how many were let go because it had deleted them: for the log. */
  took: number;
  dropped: number;
}

/**
 * This device's diary and another's, as one.
 *
 * Part by part: the same on both, kept; on one only, kept — unless the other
 * deleted it after it last changed; different on each, the later change. A
 * copy from before parts had times (an app not yet updated) has every part at
 * time 0, so nothing in it is taken for a deletion and this device's changes
 * win where the two differ.
 */
export function mergeDiaries(local: Record<string, unknown>, localTimes: SyncTimes, remote: Record<string, unknown>, remoteTimes: SyncTimes, now = Date.now()): Merged {
  const mine = partsOf(local);
  const theirs = partsOf(remote);
  const merged = new Map<string, unknown>();
  const times: SyncTimes = {};
  let took = 0;
  let dropped = 0;

  const order = [...mine.keys(), ...[...theirs.keys()].filter((part) => !mine.has(part))];
  for (const part of order) {
    const here = mine.get(part);
    const there = theirs.get(part);
    const tHere = localTimes[part];
    const tThere = remoteTimes[part];
    const atHere = tHere?.t ?? 0;
    const atThere = tThere?.t ?? 0;

    if (mine.has(part) && theirs.has(part)) {
      const same = stableJson(here) === stableJson(there);
      const useTheirs = !same && atThere > atHere;
      merged.set(part, useTheirs ? there : here);
      times[part] = useTheirs ? tThere! : (tHere ?? tThere ?? { t: 0, h: fingerprint(stableJson(here)) });
      if (useTheirs) took++;
    } else if (mine.has(part)) {
      // Theirs deleted it, after it last changed here: it goes.
      if (tThere?.gone && atThere >= atHere) {
        times[part] = tThere;
        dropped++;
      } else {
        merged.set(part, here);
        times[part] = tHere ?? { t: 0, h: fingerprint(stableJson(here)) };
      }
    } else {
      if (tHere?.gone && atHere >= atThere) {
        times[part] = tHere;
      } else {
        merged.set(part, there);
        times[part] = tThere ?? { t: 0, h: fingerprint(stableJson(there)) };
        took++;
      }
    }
  }
  // Deletions neither copy still has the part for: the later is remembered.
  for (const part of new Set([...Object.keys(localTimes), ...Object.keys(remoteTimes)])) {
    if (times[part]) continue;
    const a = localTimes[part];
    const b = remoteTimes[part];
    const later = !a ? b : !b ? a : b.t > a.t ? b : a;
    if (later?.gone) times[part] = later;
  }

  const containers = new Set([...containersOf(local), ...containersOf(remote)]);
  return { diary: diaryFrom(merged, containers), times: prune(times, now), took, dropped };
}

/** A copy's times, as sent inside it; none for a copy from an app that did not send them. */
export function timesIn(diary: unknown): SyncTimes {
  const sync = (diary as { _sync?: { times?: unknown } } | null)?._sync;
  const times = sync?.times;
  return times && typeof times === 'object' && !Array.isArray(times) ? (times as SyncTimes) : {};
}
