/**
 * A thin promise wrapper over IndexedDB for the offline publication copies.
 * Everything stored here is derived from the signed-in account's data, so
 * `deleteOfflineDatabase` runs on sign-out (lib/sign-out-client.ts).
 */

export const OFFLINE_DB_NAME = "study-notes-offline";
const DB_VERSION = 1;

/** One object store per kind of thing a downloaded publication needs. */
export const STORES = {
  /** One row per downloaded publication, keyed by the note id (stable across a reprocess, unlike the publication id). */
  publications: { keyPath: "noteId" },
  chapters: { keyPath: ["publicationId", "documentId"] },
  footnotes: { keyPath: ["publicationId", "footnoteId"] },
  extracts: { keyPath: ["publicationId", "extractId"] },
  answers: { keyPath: "publicationId" },
  /** The user's highlights and notes, one row per publication location (see marksKey). */
  marks: { keyPath: "key" },
} as const;

export type StoreName = keyof typeof STORES;

let dbPromise: Promise<IDBDatabase> | null = null;

export function isOfflineStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, options] of Object.entries(STORES)) {
        const keyPath = options.keyPath;
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: typeof keyPath === "string" ? keyPath : [...keyPath] });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading or deleting the database must not hang on this connection.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return promisify<T | undefined>(db.transaction(store, "readonly").objectStore(store).get(key));
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return promisify<T[]>(db.transaction(store, "readonly").objectStore(store).getAll());
}

export async function idbPut(store: StoreName, value: unknown): Promise<void> {
  await idbPutMany(store, [value]);
}

/** One transaction for the whole batch, so a download either lands a slice completely or not at all. */
export async function idbPutMany(store: StoreName, values: unknown[]): Promise<void> {
  if (values.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  const objectStore = tx.objectStore(store);
  for (const value of values) objectStore.put(value);
  await finished(tx);
}

export async function idbDelete(store: StoreName, key: IDBValidKey | IDBKeyRange): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await finished(tx);
}

/** Every row whose compound key starts with `prefix` (e.g. all chapters of one publication). */
export function prefixRange(prefix: IDBValidKey): IDBKeyRange {
  // An empty array sorts above every number or string, so this spans all second-key values.
  return IDBKeyRange.bound([prefix, -Infinity], [prefix, []]);
}

export async function idbGetByPrefix<T>(store: StoreName, prefix: IDBValidKey): Promise<T[]> {
  const db = await openDb();
  return promisify<T[]>(db.transaction(store, "readonly").objectStore(store).getAll(prefixRange(prefix)));
}

export async function idbDeleteByPrefix(stores: StoreName[], prefix: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(stores, "readwrite");
  for (const store of stores) tx.objectStore(store).delete(prefixRange(prefix));
  await finished(tx);
}

/** Drops the whole database — used on sign-out. */
export async function deleteOfflineDatabase(): Promise<void> {
  if (!isOfflineStorageAvailable()) return;
  try {
    (await dbPromise)?.close();
  } catch {
    // Never opened, or failed to open — nothing to close.
  }
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
