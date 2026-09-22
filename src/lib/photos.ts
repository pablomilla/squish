/**
 * Where meal photos actually live.
 *
 * Not in the diary. The diary is persisted to localStorage as one JSON string,
 * localStorage is about five megabytes, and a meal photo is three hundred
 * kilobytes — so seventeen photographed meals filled it and the eighteenth
 * could not be saved at all. That is a week of breakfasts. Measured, not
 * guessed: 300 KB a photo, 5.1 MB of quota, the app unable to write past it.
 *
 * So photos go in IndexedDB, which is sized for binary data and runs to
 * hundreds of megabytes, and the diary keeps only a thumbnail — a few
 * kilobytes, enough for the 46px row in the list, and small enough that a
 * thousand of them still fit in the backup.
 *
 * Everything here fails soft. A browser with no IndexedDB, a private window,
 * a blocked store: every function answers "nothing" and the app shows the
 * thumbnail instead. A missing photo is a smaller loss than a diary that
 * cannot save, which is what the alternative was.
 */
const DB = 'squish-photos';
const STORE = 'photos';

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
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      // Firefox in private mode neither succeeds nor errors; it blocks.
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const request = body(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Keep the full-size photo for a meal. Quiet about failing — see the header. */
export async function savePhoto(id: string, dataUrl: string): Promise<void> {
  await run('readwrite', (store) => store.put(dataUrl, id));
}

/** The full-size photo, or null where there is not one to be had. */
export async function loadPhoto(id: string): Promise<string | null> {
  const found = await run<string>('readonly', (store) => store.get(id));
  return typeof found === 'string' ? found : null;
}

export async function dropPhoto(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}

/**
 * Throw away photos belonging to meals that no longer exist.
 *
 * Deleting a meal has to take its photo with it, and so does Reset — a photo
 * of somebody's lunch outliving the diary entry it belonged to is exactly
 * what the privacy policy says does not happen. Run after anything that
 * removes meals rather than on a timer, so there is no window where it is
 * untrue.
 */
export async function keepOnly(ids: Iterable<string>): Promise<void> {
  const keep = new Set(ids);
  const all = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  if (!all) return;
  await Promise.all(all.filter((key) => typeof key === 'string' && !keep.has(key)).map((key) => dropPhoto(key as string)));
}

/** Everything, for Reset. */
export async function clearPhotos(): Promise<void> {
  await run('readwrite', (store) => store.clear());
}

/**
 * Keep the photo store in step with the diary, whatever changed it.
 *
 * Reconciliation rather than a call beside every delete. A meal can leave the
 * diary in several ways — deleted one by one, wiped by Reset, replaced
 * wholesale by a restore from backup — and a rule enforced in three places is
 * a rule that will be missed in the fourth. This asks one question instead:
 * is there a meal for this photograph, and if not, why is it here.
 *
 * Run after the diary settles rather than on every keystroke, and once at
 * startup so anything orphaned while the app was closed is cleared too.
 */
export function watchPhotos(meals: () => string[]): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sweep = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void keepOnly(meals()), 2_000);
  };
  sweep();
  return () => clearTimeout(timer);
}
