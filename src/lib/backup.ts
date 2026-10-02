/**
 * Keeping the diary on the server, for every device signed in to it.
 *
 * Talking to the server is all this does: fetching the diary, saving it, and
 * remembering which version this device last agreed about. Keeping devices in
 * step — fetching what another has saved, and putting two sets of changes
 * together — is src/lib/autobackup.ts, with the merge in src/lib/sync.ts.
 *
 * The server takes a save only from a device that has seen the latest
 * version; a device that has not is handed the latest instead, to merge with.
 */
import { apiUrl } from './origin';
import { deviceToken } from './identity';
import { splitEvents } from './events';
import type { Change } from './sync';

export type BackupState =
  | { kind: 'off' }
  | { kind: 'idle'; at: string | null }
  | { kind: 'saving' }
  | { kind: 'conflict' }
  /** The network, or the server. Worth retrying, and it retries itself. */
  | { kind: 'failed' }
  /** The diary is larger than the server will keep. Retrying cannot help. */
  | { kind: 'too_big' };

export interface RemoteDiary {
  state: unknown;
  version: number;
  updatedAt: string | null;
}

async function headers(): Promise<Record<string, string>> {
  const token = await deviceToken(apiUrl);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** What the server is holding, or null where it holds nothing or cannot say. */
export async function pullDiary(): Promise<RemoteDiary | null> {
  try {
    const response = await fetch(apiUrl('/api/diary'), { headers: await headers() });
    if (!response.ok) return null;
    const found = (await response.json()) as RemoteDiary;
    return found.version ? found : null;
  } catch {
    return null;
  }
}

/**
 * Whether another device has saved since this one last agreed: `same` if not
 * (the server says so without sending the diary), the newer diary if so, null
 * where it cannot say or there is none.
 */
export async function newerDiary(known: number | null): Promise<RemoteDiary | 'same' | null> {
  try {
    const response = await fetch(apiUrl(`/api/diary${known ? `?known=${known}` : ''}`), { headers: await headers() });
    if (!response.ok) return null;
    const found = (await response.json()) as RemoteDiary & { unchanged?: boolean };
    if (found.unchanged) return 'same';
    if (!found.version) return null;
    return found.version === known ? 'same' : found;
  } catch {
    return null;
  }
}

/**
 * Listen for saves: the server says the diary's version when this starts and
 * whenever a device saves (server/live.ts). Read with fetch, not
 * EventSource, because EventSource cannot say who is asking.
 *
 * - `ended`: the server closed it, as it does now and then; open another.
 * - `refused`: a server that does not do this, or will not now; the app
 *   goes on asking every few minutes until it next comes to the front.
 * - `failed`: the network; try again in a while.
 */
export async function hearSaves(heard: (version: number) => void, signal: AbortSignal): Promise<'ended' | 'refused' | 'failed'> {
  try {
    const response = await fetch(apiUrl('/api/diary/live'), {
      headers: { ...(await headers()), Accept: 'text/event-stream' },
      cache: 'no-store',
      signal,
    });
    if (!response.ok || !response.body) return response.status >= 500 && response.status !== 503 ? 'failed' : 'refused';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return 'ended';
      const { events, rest } = splitEvents(buffer + decoder.decode(value, { stream: true }));
      buffer = rest;
      for (const { event, data } of events) {
        if (event !== 'version') continue;
        try {
          const { version } = JSON.parse(data) as { version?: unknown };
          if (typeof version === 'number') heard(version);
        } catch {
          /* not one of ours */
        }
      }
    }
  } catch {
    return 'failed';
  }
}

/** What another device changed, as parts (src/lib/sync.ts), with the past chats where they changed. */
export interface RemoteChanges {
  version: number;
  updatedAt: string | null;
  change: Change;
  /** The past chats, where they changed; null where they are no longer kept. */
  pastChats?: unknown;
}

/**
 * What changed since the version this device has: `same`, the parts that
 * did, or the whole diary for a device further behind than the server can
 * say by parts. `unsupported` is a server from before it could say.
 */
export async function changesSince(known: number): Promise<'same' | 'unsupported' | { whole: RemoteDiary } | RemoteChanges | null> {
  try {
    const response = await fetch(apiUrl(`/api/diary/changes?since=${known}`), { headers: await headers() });
    if (response.status === 404) return 'unsupported';
    if (!response.ok) return null;
    const found = (await response.json()) as Partial<RemoteChanges> & { unchanged?: boolean; whole?: RemoteDiary; version?: number };
    if (found.unchanged) return 'same';
    if (found.whole) return found.whole.version ? { whole: found.whole } : null;
    if (found.change && typeof found.version === 'number') return found as RemoteChanges;
    return null;
  } catch {
    return null;
  }
}

export type PatchResult =
  | ({ kind: 'saved'; at: string } & RemoteChanges)
  /** Saved; but what else changed could not be said by parts, so here is the whole diary. */
  | { kind: 'saved'; version: number; at: string; whole: RemoteDiary }
  /** Not saved: no diary there, a different one, or a server from before parts. Save the whole diary. */
  | { kind: 'whole' }
  | { kind: 'too_big' }
  | { kind: 'failed' };

/** Save what changed since `base`; the answer brings what other devices changed meanwhile. */
export async function patchDiary(base: number, change: Change, pastChats?: unknown): Promise<PatchResult> {
  try {
    const response = await fetch(apiUrl('/api/diary'), {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify({ base, change, ...(pastChats === undefined ? {} : { pastChats }) }),
    });
    if (response.status === 404 || response.status === 405 || response.status === 409) return { kind: 'whole' };
    if (response.status === 413) return { kind: 'too_big' };
    if (!response.ok) return { kind: 'failed' };
    const body = (await response.json()) as { version: number; updatedAt: string; change?: Change; pastChats?: unknown; whole?: RemoteDiary };
    if (body.whole) return { kind: 'saved', version: body.version, at: body.updatedAt, whole: body.whole };
    return { kind: 'saved', version: body.version, at: body.updatedAt, updatedAt: body.updatedAt, change: body.change ?? { parts: {}, times: {}, containers: [] }, ...('pastChats' in body ? { pastChats: body.pastChats } : {}) };
  } catch {
    return { kind: 'failed' };
  }
}

export type PushResult =
  | { kind: 'saved'; version: number; at: string }
  | { kind: 'conflict'; current: RemoteDiary }
  | { kind: 'too_big' }
  | { kind: 'failed' };

export async function pushDiary(state: unknown, version: number | null): Promise<PushResult> {
  try {
    const response = await fetch(apiUrl('/api/diary'), {
      method: 'PUT',
      headers: await headers(),
      body: JSON.stringify({ state, version }),
    });

    if (response.status === 409) {
      const body = (await response.json()) as { current: RemoteDiary };
      return { kind: 'conflict', current: body.current };
    }
    // Distinguished from a failure because the answer is different: one is
    // waited out, the other has to be acted on.
    if (response.status === 413) return { kind: 'too_big' };
    if (!response.ok) return { kind: 'failed' };

    const body = (await response.json()) as { version: number; updatedAt: string };
    return { kind: 'saved', version: body.version, at: body.updatedAt };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * The version this browser last agreed with the server about.
 *
 * Kept beside the diary rather than in it, because it is a fact about the
 * conversation with the server and not about anybody's food — and because
 * putting it inside the diary would mean every backup changed the thing it
 * was backing up.
 */
const VERSION_KEY = 'squish-backup-version';

export function knownVersion(): number | null {
  try {
    const raw = localStorage.getItem(VERSION_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function rememberVersion(version: number | null): void {
  try {
    if (version === null) localStorage.removeItem(VERSION_KEY);
    else localStorage.setItem(VERSION_KEY, String(version));
  } catch {
    /* private browsing — every push is a first push, which the server handles */
  }
}

/**
 * Throw the backup away, because somebody asked to start over.
 *
 * Called before the local diary is cleared, not after: once the store is
 * empty the automatic backup would push that emptiness up within seconds
 * anyway, and a deletion somebody asked for should not depend on a debounce
 * winning a race. Failure is silent — the reset still happens, and the next
 * push overwrites the old copy regardless.
 */
export async function forgetBackup(): Promise<void> {
  try {
    await fetch(apiUrl('/api/diary'), { method: 'DELETE', headers: await headers() });
  } catch {
    /* offline: the next push replaces it with the empty diary */
  }
  rememberVersion(null);
}
