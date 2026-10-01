/**
 * Keeping the diary on the account, and every signed-in device in step.
 *
 * Subscribed to the store rather than called from the screens, because a
 * save somebody has to trigger is a save that happens the day after they
 * needed it. It waits for a quiet moment — nobody wants a network call per
 * keystroke in the meal title — and gets out of the way of everything else.
 *
 * Keeping in step, which used to be "backing up, and stopping when another
 * device had saved":
 *
 * - Before each save, what changed is noted, part by part, with when
 *   (src/lib/sync.ts). The times go up with the diary.
 * - While the app is open on screen it holds a line to the server, which
 *   says the moment another device saves (server/live.ts). It also asks
 *   when it opens, comes back to the front or back online, and every few
 *   minutes, in case a cue was missed. The server answers in a few bytes
 *   when nothing has changed.
 * - If another device has saved and nothing has changed here, its diary is
 *   simply taken. If both have changed, the two are merged — every meal and
 *   plan has an id, so lunch logged on each is two lunches, and the same one
 *   changed on both is the later change — and the merged diary is saved.
 * - The one case it does not decide is a device that has never been in step
 *   with this account's diary — just signed in, holding a diary of its own —
 *   when both are real diaries: they may be two people's. Saving pauses and
 *   the You screen asks which to keep, or to combine them.
 *
 * Every failure is silent to the app and visible in the one place that asks.
 * Squish has always worked with no network and it still does; a save that
 * could interrupt somebody logging their lunch would be worse than none.
 */
import { useSquish } from '../store/useSquish';
import { hearSaves, knownVersion, newerDiary, pushDiary, rememberVersion, type BackupState, type RemoteDiary } from './backup';
import { isBlank } from './blankDiary';
import { chatsForBackup, forgetChats, goneChats, importChats, listChats, onChatsChanged } from './chats';
import { fingerprintOf, mergeDiaries, prune, stamp, timesIn, type SyncTimes } from './sync';

/** Long enough that a burst of edits is one push, short enough that another device open beside this one shows it straight away. */
const QUIET_MS = 2_000;
/** How often an open app asks whether another device has saved, in case it missed being told. */
const CHECK_MS = 3 * 60_000;
/** Merges in a row before giving up for now: another device saving faster than this one can merge is not a loop to stay in. */
const MAX_ROUNDS = 3;

let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
let checking = false;
let stopped = false;
let rounds = 0;
/** Told of a save while busy saving or looking: look again once done. */
let missed = false;
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

/* ------------------------------------------------------------------ *
 * What changed, and whether there is anything to say. Kept beside the
 * diary, like the version: facts about keeping in step, not about food.
 * ------------------------------------------------------------------ */

const TIMES_KEY = 'squish-sync-times';
const DIRTY_KEY = 'squish-sync-dirty';
/** The past chats as last saved: they are merged by their own rules, outside the parts, but a change to them is still something to save. */
const CHATS_KEY = 'squish-sync-chats';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing: kept for as long as the page is open */
  }
}

let times: SyncTimes = load<SyncTimes>(TIMES_KEY, {});
// Absent the first time this runs: there is something to say, the diary as it stands.
let dirty: boolean = load<boolean>(DIRTY_KEY, true);
let chatsPrint: string = load<string>(CHATS_KEY, '');

/**
 * Whose diary the server holds changed under this device — signed in, out,
 * or the account deleted — and nothing has been settled since: a diary
 * waiting there may be somebody else's. Set by the switch, and cleared by
 * the first save, the diary being taken, or a choice on the You screen.
 * Not "has no version": a device can lose that (a save cut off by closing
 * the page) and still be talking to its own diary.
 */
const ASK_KEY = 'squish-sync-ask';
let askFirst: boolean = load<boolean>(ASK_KEY, false);
function setAskFirst(next: boolean): void {
  askFirst = next;
  save(ASK_KEY, next);
}

function setTimes(next: SyncTimes): void {
  times = next;
  save(TIMES_KEY, times);
}
function setDirty(next: boolean): void {
  dirty = next;
  save(DIRTY_KEY, next);
}

/**
 * Everything worth keeping, which is the persisted store minus nothing — and
 * the past chats with the nutritionist, where they have chosen to take them
 * with them (they live outside the store, in src/lib/chats.ts).
 */
function snapshot(): Record<string, unknown> {
  const { profile, targets, meals, days, favourites, plans, shopping, household, recipes, planLog, notForMe, unlocked, nutritionistNotes, look, outfit, scene, shareDecor, theme, comparisons, backupChats } = useSquish.getState();
  return {
    profile, targets, meals, days, favourites, plans, shopping, household, recipes, planLog, notForMe, unlocked, nutritionistNotes, look, outfit, scene, shareDecor, theme, comparisons, backupChats,
    ...(backupChats ? { pastChats: chatsForBackup() } : {}),
    // Chats deleted by hand go from every device, whether or not chats themselves are backed up.
    chatsGone: goneChats(),
  };
}

/** Note what has changed since last time, with when. True if anything had. */
function noteChanges(): boolean {
  const now = Date.now();
  const diary = snapshot();
  const found = stamp(diary, times, now);
  // Past chats are not parts (src/lib/chats.ts merges them), but one kept, carried on or deleted is still news.
  const print = fingerprintOf(diary.pastChats ?? null);
  const chatsChanged = print !== chatsPrint;
  if (chatsChanged) {
    chatsPrint = print;
    save(CHATS_KEY, print);
  }
  if (!found.changed && !chatsChanged) return false;
  if (found.changed) setTimes(prune(found.times, now));
  setDirty(true);
  return true;
}

/** Put a diary on this device: its times first, so taking it is not mistaken for a change made here. */
function apply(diary: Record<string, unknown>, diaryTimes: SyncTimes): void {
  const { pastChats, chatsGone, _sync: _left, ...rest } = diary;
  setTimes(diaryTimes);
  useSquish.setState(rest as Partial<ReturnType<typeof useSquish.getState>>);
  // Past chats live where chats live: the ones deleted elsewhere go first, then the rest are merged with any already here.
  void forgetChats(chatsGone).then(() => (pastChats ? importChats(pastChats) : undefined));
  // Whatever the store filled in that the diary did not have, from now on.
  noteChanges();
}

/** Another device's diary, as it is: nothing had changed here to keep. */
function adopt(found: RemoteDiary): void {
  setAskFirst(false);
  const diary = (found.state ?? {}) as Record<string, unknown>;
  const sent = timesIn(diary);
  // A diary from an app that sent no times: every part as old as can be, so nothing in it outranks a later change.
  apply(diary, Object.keys(sent).length ? sent : stamp(diary, {}, 0).times);
  rememberVersion(found.version);
  setDirty(false);
}

/** Both devices' changes, as one diary, to be saved. */
function combine(found: RemoteDiary): void {
  setAskFirst(false);
  const theirs = (found.state ?? {}) as Record<string, unknown>;
  noteChanges();
  const merged = mergeDiaries(snapshot(), times, theirs, timesIn(theirs));
  // The other device's past chats, which the diary's merge leaves to the chats' own (by id, the longer kept).
  apply(theirs.pastChats ? { ...merged.diary, pastChats: theirs.pastChats } : merged.diary, merged.times);
  rememberVersion(found.version);
  setDirty(true);
  if (merged.took || merged.dropped) console.info(`[squish] kept in step: ${merged.took} from another device, ${merged.dropped} deleted there`);
}

/**
 * What to do with a newer diary from the server.
 *
 * - `adopted`: nothing had changed here, so it is now this device's diary.
 * - `merged`: both had changed; this device now holds both, to be saved.
 * - `ask`: this device has never been in step with this diary and both are
 *   real diaries — it is not a decision to take behind anybody's back.
 */
function takeIn(found: RemoteDiary): 'adopted' | 'merged' | 'ask' {
  if (isBlank(found.state)) {
    // Nothing there worth keeping: this device's diary goes up over it.
    rememberVersion(found.version);
    setDirty(true);
    return 'merged';
  }
  noteChanges();
  if (askFirst) {
    if (isBlank(snapshot())) {
      adopt(found);
      return 'adopted';
    }
    return 'ask';
  }
  if (!dirty) {
    adopt(found);
    return 'adopted';
  }
  combine(found);
  return 'merged';
}

async function push(): Promise<void> {
  await pushOnce();
  lookAgain();
}

async function pushOnce(): Promise<void> {
  if (inFlight || stopped) return;
  if (checking) {
    soon();
    return;
  }
  noteChanges();
  // Nothing new to say, and the server already has it.
  if (!dirty && knownVersion() !== null) {
    if (state.kind !== 'idle') announce({ kind: 'idle', at: null });
    return;
  }
  inFlight = true;
  announce({ kind: 'saving' });

  const sent = { ...snapshot(), _sync: { times } };
  const result = await pushDiary(sent, knownVersion());
  inFlight = false;

  if (result.kind === 'saved') {
    // Saved: whatever the server holds is this diary now.
    setAskFirst(false);
    rememberVersion(result.version);
    setDirty(false);
    rounds = 0;
    announce({ kind: 'idle', at: result.at });
    // Changed again while that was on its way: say that too.
    if (noteChanges()) soon();
    return;
  }
  if (result.kind === 'too_big') {
    // Stopped, like a conflict, because every further push would be refused
    // the same way and a card that says "saving…" for ever is a lie.
    stopped = true;
    announce({ kind: 'too_big' });
    return;
  }
  if (result.kind === 'conflict') {
    // Another device saved first. Take its changes in, then save both.
    const outcome = takeIn(result.current);
    if (outcome === 'ask') {
      stopped = true;
      announce({ kind: 'conflict' });
      return;
    }
    if (outcome === 'merged') {
      rounds++;
      if (rounds > MAX_ROUNDS) {
        rounds = 0;
        announce({ kind: 'failed' });
        soon();
        return;
      }
      await pushOnce();
      return;
    }
    rounds = 0;
    announce({ kind: 'idle', at: result.current.updatedAt });
    return;
  }
  announce({ kind: 'failed' });
}

/** Has another device saved? Then take its changes in now, rather than when this one next saves. */
async function check(): Promise<void> {
  if (stopped || state.kind === 'off') return;
  if (inFlight || checking) {
    missed = true;
    return;
  }
  const known = knownVersion();
  // Never saved here: the first save will find out what is there, and ask if it must.
  if (known === null) return;
  checking = true;
  try {
    const found = await newerDiary(known);
    if (!found || found === 'same' || inFlight) return;
    const outcome = takeIn(found);
    if (outcome === 'ask') {
      stopped = true;
      announce({ kind: 'conflict' });
    } else if (outcome === 'merged') {
      soon();
    } else {
      announce({ kind: 'idle', at: found.updatedAt });
    }
  } finally {
    checking = false;
  }
  lookAgain();
}

/** Done saving or looking: if told of a save meanwhile that neither brought in, look now. */
function lookAgain(): void {
  if (!missed || inFlight || checking) return;
  missed = false;
  if (heard > (knownVersion() ?? 0)) void check();
}

/* ------------------------------------------------------------------ *
 * Being told: a line held open to the server while the app is on screen.
 * ------------------------------------------------------------------ */

let line: AbortController | null = null;
let lineRetry: ReturnType<typeof setTimeout> | undefined;
let linePause = 2_000;
/** The newest version the server has said there is. */
let heard = 0;

/** A device saved: look, unless it was this one and this one already knows. */
function heardSave(version: number): void {
  heard = Math.max(heard, version);
  const known = knownVersion();
  if (known === null || version <= known) return;
  void check();
}

function openLine(): void {
  if (line || state.kind === 'off' || document.visibilityState !== 'visible') return;
  clearTimeout(lineRetry);
  const mine = new AbortController();
  line = mine;
  const opened = Date.now();
  void hearSaves(heardSave, mine.signal).then((how) => {
    // Closed here, on purpose: nothing to reopen.
    if (line !== mine) return;
    line = null;
    if (how === 'refused') return;
    // One that had been open a while was working: back straight away. One that keeps failing waits longer each time.
    const lasted = Date.now() - opened > 30_000;
    if (lasted) linePause = 2_000;
    lineRetry = setTimeout(openLine, lasted ? 1_000 : linePause);
    if (!lasted) linePause = Math.min(linePause * 2, 60_000);
  });
}

function closeLine(): void {
  clearTimeout(lineRetry);
  const mine = line;
  line = null;
  mine?.abort();
}

function reopenLine(): void {
  closeLine();
  linePause = 2_000;
  // Perhaps another diary's now (signed in or out): it says its version as the line opens.
  heard = 0;
  openLine();
}

function soon(): void {
  if (stopped) return;
  clearTimeout(timer);
  timer = setTimeout(() => void push(), QUIET_MS);
}

/**
 * Start keeping in step. Safe to call twice; does nothing where the server
 * keeps nothing, which is how Squish runs on a laptop.
 */
export function startBackup(enabled: boolean): () => void {
  if (!enabled) {
    announce({ kind: 'off' });
    return () => {};
  }

  stopped = false;
  announce({ kind: 'idle', at: null });

  const unsubscribe = useSquish.subscribe(soon);
  // A chat kept or deleted is not a change to the store, but where chats are backed up it is one to the backup.
  const unsubscribeChats = onChatsChanged(() => useSquish.getState().backupChats && soon());
  // Read once now, so the backup has them — they are read from IndexedDB, not the store — and saved if that is news.
  void listChats().then(soon);

  // What another device saved while this one was closed, as soon as it opens.
  const first = setTimeout(() => void check(), 1_500);
  const every = setInterval(() => {
    if (document.visibilityState === 'visible') void check();
  }, CHECK_MS);
  // And told the moment one does, while on screen.
  openLine();
  // Signed in or out: whose diary to hear about has changed.
  onSwitch.add(reopenLine);

  // A tab being closed is the commonest moment for the last few minutes to be
  // lost, and it is too late for a debounce by then. Coming back to it is the
  // commonest moment for another device to have been used in the meantime.
  const onVisibility = () => {
    // Put away: a phone would pause the line anyway, and the server need not hold it.
    if (document.visibilityState === 'hidden') closeLine();
    else reopenLine();
    if (stopped) return;
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer);
      void push();
    } else {
      void check();
    }
  };
  const onOnline = () => {
    void check();
    reopenLine();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);

  return () => {
    unsubscribe();
    unsubscribeChats();
    clearTimeout(first);
    clearInterval(every);
    onSwitch.delete(reopenLine);
    closeLine();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    clearTimeout(timer);
  };
}

/**
 * Make the account's diary this device's — Restore on the You screen,
 * "Use the backup", and signing in on a new phone.
 *
 * Merged over the current state rather than replacing it, so a key this
 * version has and the backup does not keeps its default instead of becoming
 * undefined halfway down the app.
 */
export function adoptBackup(found: RemoteDiary): void {
  adopt(found);
  stopped = false;
  announce({ kind: 'idle', at: null });
}

/** "Combine both": this device's diary and the account's, merged, and saved. */
export function combineWithBackup(found: RemoteDiary): void {
  combine(found);
  stopped = false;
  announce({ kind: 'idle', at: null });
  soon();
}

/** After "Keep this device's", or a switch of account: this device's diary is the one to save. */
export function resumeBackup(version: number | null): void {
  setAskFirst(false);
  rememberVersion(version);
  setDirty(true);
  stopped = false;
  announce({ kind: 'idle', at: null });
}

/**
 * Signing in, signing out or deleting an account changes whose diary the
 * server thinks this device holds.
 *
 * Announced separately from the state, because the state does not change —
 * before and after are both `idle` — and anything showing what is on the
 * server has to go and look again. Without this, somebody signing in on a new
 * phone finds Restore greyed out, which is the one thing they signed in for.
 */
const onSwitch = new Set<() => void>();

export function watchIdentity(listener: () => void): () => void {
  onSwitch.add(listener);
  return () => onSwitch.delete(listener);
}

export function switchedIdentity({ broughtDiary = false }: { broughtDiary?: boolean } = {}): void {
  // Whatever version this browser last agreed about referred to a different
  // diary. Forgetting it means the next save either starts cleanly or is told
  // there is already one there — and, never having been in step with that
  // one, asks rather than merges.
  //
  // Except where the diary came along: signing up (or into an account with
  // no diary) hands this device's diary to the account as it is, version and
  // all. Forgetting the version then made the very next save collide with
  // the diary it had just become, and the backup stopped — leaving the
  // account holding whatever was saved before, which at the end of
  // onboarding was a diary not yet set up.
  resumeBackup(broughtDiary ? knownVersion() : null);
  // A diary already on the account may not be this one's: ask before mixing them. One brought along is this one.
  setAskFirst(!broughtDiary);
  for (const listener of onSwitch) listener();
}
