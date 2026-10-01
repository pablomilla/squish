/**
 * Telling a person's other open devices, the moment their diary is saved.
 *
 * Each open app holds one request open here (server-sent events) and is told
 * the diary's version: once on arrival, then again whenever a save moves it
 * on. Nothing more — no diary, no meal, nothing anybody wrote. Being told is
 * only a cue: the device asks for the diary the way it always has, and merges
 * it the way it always has (src/lib/autobackup.ts). A device that misses a
 * cue loses nothing but a few minutes, because it still asks on its own.
 *
 * Saves can land on any instance, so they are announced through Postgres
 * (NOTIFY) and every instance passes them to the devices it holds open. With
 * that connection down, an instance still tells its own.
 */
import type { Request, Response } from 'express';
import { hasDatabase, listen, query, type Listening } from './db';

const CHANNEL = 'squish_diary';
/** A comment down the line now and then, so nothing between here and the phone takes a quiet line for a dead one. */
const PING_MS = 25_000;
/** Ended now and then, so a connection nothing noticed dying does not sit here for ever. The app comes straight back. */
const LIFETIME_MS = 20 * 60_000;
/** One person's open devices. Far more than anybody has; the oldest goes first. */
const PER_OWNER = 10;
/** Everybody's, on this instance. A newcomer past it is turned away, and its app goes on asking every few minutes. */
const MOST = 5_000;

interface Watcher {
  res: Response;
  end(): void;
}

const watching = new Map<string, Set<Watcher>>();
let count = 0;
let listening: Listening | null = null;

function tell(owner: string, version: number): void {
  for (const watcher of watching.get(owner) ?? []) {
    watcher.res.write(`event: version\ndata: ${JSON.stringify({ version })}\n\n`);
  }
}

function heard(payload: string): void {
  try {
    const { owner, version } = JSON.parse(payload) as { owner?: unknown; version?: unknown };
    if (typeof owner === 'string' && typeof version === 'number') tell(owner, version);
  } catch {
    /* not ours */
  }
}

/** Saved: every device of this owner's, on every instance, is told. */
export async function announceDiary(owner: string, version: number): Promise<void> {
  // Nobody listening anywhere costs a NOTIFY nobody hears; cheaper than finding out.
  if (hasDatabase()) {
    try {
      await query('select pg_notify($1, $2)', [CHANNEL, JSON.stringify({ owner, version })]);
      if (listening?.connected()) return;
    } catch {
      /* told here, below, at least */
    }
  }
  tell(owner, version);
}

/** How many devices are listening on this instance, for tests and the dashboard. */
export const liveCount = (): number => count;

/**
 * Hold this request open and tell it the diary's version as it changes.
 * `version` is what it is now, said first so a device coming back after a
 * gap catches up at once.
 */
export function watchDiary(owner: string, version: number, req: Request, res: Response): void {
  if (count >= MOST) {
    res.status(503).json({ error: 'busy' });
    return;
  }
  if (hasDatabase()) listening ??= listen(CHANNEL, heard);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Proxies that buffer would hold every cue until the line closed.
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: version\ndata: ${JSON.stringify({ version })}\n\n`);

  const mine = watching.get(owner) ?? new Set<Watcher>();
  watching.set(owner, mine);

  let ended = false;
  const ping = setInterval(() => res.write(': still here\n\n'), PING_MS);
  // Spread out, so a deploy's worth of devices do not all come back in the same second.
  const expire = setTimeout(() => watcher.end(), LIFETIME_MS + Math.random() * 60_000);
  const watcher: Watcher = {
    res,
    end() {
      if (ended) return;
      ended = true;
      clearInterval(ping);
      clearTimeout(expire);
      mine.delete(watcher);
      if (!mine.size) watching.delete(owner);
      count--;
      res.end();
    },
  };
  mine.add(watcher);
  count++;
  if (mine.size > PER_OWNER) [...mine][0].end();

  req.on('close', () => watcher.end());
}

/** Shutting down: every line closed, so the apps reconnect to whichever instance is next. */
export async function stopWatching(): Promise<void> {
  for (const mine of [...watching.values()]) for (const watcher of [...mine]) watcher.end();
  await listening?.stop();
  listening = null;
}
