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
import { keepFrom, type PastChat } from './pastChats';

export { MAX_AGE_DAYS, MAX_CHATS, newChatId, titleOf, wireOf, type ChatTurn, type PastChat } from './pastChats';

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

const isChat = (value: unknown): value is PastChat => {
  const chat = value as PastChat;
  return Boolean(chat) && typeof chat.id === 'string' && Array.isArray(chat.turns) && typeof chat.updatedAt === 'number';
};

/** Every past chat, newest first, the ones past their time let go on the way. */
export async function listChats(): Promise<PastChat[]> {
  const db = await open();
  const all = db ? ((await run<unknown[]>('readonly', (store) => store.getAll())) ?? []).filter(isChat) : [...memory.values()];
  const { keep, drop } = keepFrom(all);
  if (drop.length) await Promise.all(drop.map((chat) => deleteChat(chat.id)));
  return keep;
}

/** Keep a chat as it stands now; the oldest go if there are more than there should be. */
export async function saveChat(chat: PastChat): Promise<void> {
  if (!chat.turns.length) return;
  const db = await open();
  if (db) await run('readwrite', (store) => store.put(chat));
  else memory.set(chat.id, chat);
  await listChats();
}

export async function deleteChat(id: string): Promise<void> {
  memory.delete(id);
  await run('readwrite', (store) => store.delete(id));
}

/** Everything, for Reset. */
export async function clearChats(): Promise<void> {
  memory.clear();
  await run('readwrite', (store) => store.clear());
}
