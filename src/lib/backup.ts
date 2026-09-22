/**
 * Keeping a copy of the diary on the server.
 *
 * One-directional on purpose. The browser holds the diary and decides what is
 * true; this pushes a copy up so that a cleared browser, a lost phone or a new
 * laptop is an inconvenience rather than the end of six weeks of logging. It
 * is a backup, not a sync — nothing it does ever changes what is on this
 * device without somebody asking.
 *
 * The one case it will not decide is a conflict: the server holding a version
 * this browser has not seen. That only happens with two devices signed into
 * one account, and merging two food diaries by machine means guessing whether
 * two similar lunches are one lunch logged twice or two lunches actually
 * eaten. There is no answer to that which is right often enough to apply
 * behind somebody's back, so backing up stops and says so.
 */
import { apiUrl } from './origin';
import { deviceToken } from './identity';
import { storedPasscode } from './api';

export type BackupState =
  | { kind: 'off' }
  | { kind: 'idle'; at: string | null }
  | { kind: 'saving' }
  | { kind: 'conflict' }
  | { kind: 'failed' };

export interface RemoteDiary {
  state: unknown;
  version: number;
  updatedAt: string | null;
}

async function headers(): Promise<Record<string, string>> {
  const passcode = storedPasscode();
  const token = await deviceToken(apiUrl);
  return {
    'Content-Type': 'application/json',
    ...(passcode ? { 'x-squish-pass': passcode } : {}),
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

export type PushResult =
  | { kind: 'saved'; version: number; at: string }
  | { kind: 'conflict'; current: RemoteDiary }
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
