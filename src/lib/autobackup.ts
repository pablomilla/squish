/**
 * Backing the diary up without anybody having to remember to.
 *
 * Subscribed to the store rather than called from the screens, because a
 * backup somebody has to trigger is a backup that happens the day after they
 * needed it. It waits for a quiet moment — nobody wants a network call per
 * keystroke in the meal title — and gets out of the way of everything else.
 *
 * Every failure is silent to the app and visible in the one place that asks.
 * Squish has always worked with no network and it still does; a backup that
 * could interrupt somebody logging their lunch would be worse than no backup.
 */
import { useSquish } from '../store/useSquish';
import { knownVersion, pushDiary, rememberVersion, type BackupState } from './backup';

/** Long enough that a burst of edits is one push, short enough to be a backup. */
const QUIET_MS = 6_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
let stopped = false;
let state: BackupState = { kind: 'off' };
const listeners = new Set<(state: BackupState) => void>();

function announce(next: BackupState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

export const backupState = (): BackupState => state;

export function watchBackup(listener: (state: BackupState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/** Everything worth keeping, which is the persisted store minus nothing. */
function snapshot(): unknown {
  const { profile, targets, meals, days, favourites, unlocked, nutritionistNotes, look, theme } = useSquish.getState();
  return { profile, targets, meals, days, favourites, unlocked, nutritionistNotes, look, theme };
}

async function push(): Promise<void> {
  if (inFlight || stopped) return;
  inFlight = true;
  announce({ kind: 'saving' });

  const result = await pushDiary(snapshot(), knownVersion());
  inFlight = false;

  if (result.kind === 'saved') {
    rememberVersion(result.version);
    announce({ kind: 'idle', at: result.at });
    return;
  }
  if (result.kind === 'conflict') {
    // Stop. Another device has written something this one has not seen, and
    // choosing between two diaries is not a decision to take silently.
    stopped = true;
    announce({ kind: 'conflict' });
    return;
  }
  announce({ kind: 'failed' });
}

/**
 * Start backing up. Safe to call twice; does nothing where the server keeps
 * nothing, which is how Squish runs on a laptop.
 */
export function startBackup(enabled: boolean): () => void {
  if (!enabled) {
    announce({ kind: 'off' });
    return () => {};
  }

  stopped = false;
  announce({ kind: 'idle', at: null });

  const unsubscribe = useSquish.subscribe(() => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void push(), QUIET_MS);
  });

  // A tab being closed is the commonest moment for the last few minutes to be
  // lost, and it is too late for a debounce by then.
  const onHide = () => {
    if (document.visibilityState === 'hidden' && !stopped) {
      clearTimeout(timer);
      void push();
    }
  };
  document.addEventListener('visibilitychange', onHide);

  return () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', onHide);
    clearTimeout(timer);
  };
}

/** After a restore or a resolved conflict: this browser is the truth again. */
export function resumeBackup(version: number | null): void {
  rememberVersion(version);
  stopped = false;
  announce({ kind: 'idle', at: null });
}
