/**
 * Past chats with the nutritionist, kept on this phone.
 *
 * Kept so the advice itself can be found again — the three breakfasts it
 * suggested, why the weekends run over — and so a conversation can be carried
 * on where it stopped. On this device only, never on the server: a chat can
 * hold a lot about somebody's health, and nothing about keeping it needs it
 * anywhere else. It is in the data export and goes with Reset.
 *
 * In IndexedDB rather than the store, so a long history can never crowd the
 * diary out of the few megabytes the store has. The newest 30 are kept, and
 * none older than 90 days: enough to look back on, not a transcript for life.
 *
 * What is kept is what was said, as it was shown — the questions, the answers
 * and the lookups above them — not the lookups' results. Carried on, a chat
 * sends its words back and the nutritionist looks things up again, fresh.
 */
import { forBackup, isPastChat, keepFrom, keepGone, mergeChats, mergeGone, withoutGone, type GoneChats, type PastChat } from './pastChats';

export { MAX_AGE_DAYS, MAX_CHATS, newChatId, titleOf, wireOf, type ChatTurn, type GoneChats, type PastChat } from './pastChats';

const DB = 'squish-chats';
const STORE = 'chats';

/* ------------------------------------------------------------------ *
 * Keeping them. Where IndexedDB will not open (private browsing in some
 * browsers), they last as long as the page does.
 * ------------------------------------------------------------------ */

const memory = new Map<string, PastChat>();
let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) {
          resolve(undefined);
          return;
        }
        try {
          const request = body(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/*
 * The chats as last read, for the backup, which is built in one go and cannot
 * wait on IndexedDB; and who to tell when they change, so it goes again.
 */
let latest: PastChat[] = [];
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

export function onChatsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chats to put in the diary backup, from the last time they were read. */
export const chatsForBackup = (): PastChat[] => withoutGone(forBackup(latest), gone);

/* ------------------------------------------------------------------ *
 * Chats deleted by hand, so they go from every device (src/lib/pastChats.ts
 * has the why). Beside the chats rather than in IndexedDB: it is small, and
 * the backup reads it at once.
 * ------------------------------------------------------------------ */

const GONE_KEY = 'squish-chats-gone';
let gone: GoneChats = (() => {
  try {
    return keepGone(JSON.parse(localStorage.getItem(GONE_KEY) ?? '{}'));
  } catch {
    return {};
  }
})();

function keepGoneHere(next: GoneChats): void {
  gone = next;
  try {
    localStorage.setItem(GONE_KEY, JSON.stringify(gone));
  } catch {
    /* private browsing: remembered while the page is open */
  }
}

/** The chats deleted by hand here or on another device, for the diary to carry. */
export const goneChats = (): GoneChats => keepGone(gone);

/** Chats another device deleted: noted here too, and deleted here if they are here. */
export async function forgetChats(arriving: unknown): Promise<void> {
  keepGoneHere(mergeGone(gone, arriving));
  const here = await listChats();
  const going = here.filter((chat) => chat.id in gone);
  if (!going.length) return;
  await Promise.all(going.map((chat) => deleteChat(chat.id, false)));
  changed();
}

/** Every past chat, newest first, the ones past their time let go on the way. */
export async function listChats(): Promise<PastChat[]> {
  const db = await open();
  const all = db ? ((await run<unknown[]>('readonly', (store) => store.getAll())) ?? []).filter(isPastChat) : [...memory.values()];
  const { keep, drop } = keepFrom(all);
  if (drop.length) await Promise.all(drop.map((chat) => deleteChat(chat.id, false)));
  latest = keep;
  return keep;
}

/** Keep a chat as it stands now; the oldest go if there are more than there should be. */
export async function saveChat(chat: PastChat): Promise<void> {
  if (!chat.turns.length) return;
  const db = await open();
  if (db) await run('readwrite', (store) => store.put(chat));
  else memory.set(chat.id, chat);
  await listChats();
  changed();
}

/**
 * Chats from a backup (a new phone, a restore), merged with any already
 * here: nothing on this phone is lost, and the same chat carried on in two
 * places keeps the longer of the two.
 */
export async function importChats(arriving: unknown): Promise<void> {
  // A chat deleted here, or on another device, is not taken back from a copy that still has it.
  const merged = withoutGone(mergeChats(await listChats(), arriving), gone);
  const db = await open();
  for (const chat of merged) {
    if (db) await run('readwrite', (store) => store.put(chat));
    else memory.set(chat.id, chat);
  }
  await listChats();
  changed();
}

/**
 * Delete a chat. `announce` is somebody deleting it: noted, so it goes from
 * their other devices too. Without it, it is the limits letting an old chat
 * go, which every device does for itself.
 */
export async function deleteChat(id: string, announce = true): Promise<void> {
  if (announce) keepGoneHere({ ...gone, [id]: Date.now() });
  memory.delete(id);
  await run('readwrite', (store) => store.delete(id));
  latest = latest.filter((chat) => chat.id !== id);
  if (announce) changed();
}

/** Everything, for Reset. */
export async function clearChats(): Promise<void> {
  keepGoneHere({});
  memory.clear();
  await run('readwrite', (store) => store.clear());
  latest = [];
  changed();
}
