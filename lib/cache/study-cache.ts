import { idbGet, idbPut, isOfflineStorageAvailable } from "@/lib/offline/idb";

/**
 * A stale-while-revalidate cache for the per-chapter data the Bible study
 * panel shows (study notes, videos, the research guide), in two layers:
 *
 *   memory  → instant, lives for the tab, capped (LRU);
 *   IndexedDB (`studyCache` store) → survives reloads and works offline.
 *
 * Whatever is cached is painted immediately and then re-fetched in the
 * background; the screen only updates if the server's copy actually differs.
 * That is what makes it safe without any invalidation protocol — a re-imported
 * research guide or a re-indexed video catalogue shows up the next time the
 * chapter is opened, instead of the user waiting on a round trip every time.
 *
 * The data is public reference content (the same for every account), so unlike
 * the notes store there is nothing private in here — the IndexedDB database is
 * still wiped on sign-out with everything else (lib/sign-out-client.ts).
 */

export interface StudyResult<T> {
  data?: T;
  error?: string;
}

interface MemoryEntry {
  data: unknown;
  savedAt: number;
}

interface PersistedRow {
  key: string;
  json: string;
  savedAt: number;
}

/** Chapters kept in memory. A research-guide chapter can be a few hundred KB of HTML. */
const MEMORY_LIMIT = 24;
/** A memory hit older than this is re-checked against the server in the background. */
const REVALIDATE_AFTER_MS = 2 * 60 * 1000;
/** Bump to discard every persisted row when a cached payload's shape changes. */
const CACHE_VERSION = "v1";

const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<unknown | undefined>>();

export function studyCacheKey(kind: string, bookOrder: number, chapter: number): string {
  return `${CACHE_VERSION}:${kind}:${bookOrder}:${chapter}`;
}

function remember(key: string, data: unknown, savedAt = Date.now()) {
  memory.delete(key); // re-insert so the Map's order is recency
  memory.set(key, { data, savedAt });
  while (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/** The in-memory copy, if any — synchronous, so a hook can paint it on the very first render. */
export function peekStudyCache<T>(key: string): T | undefined {
  return memory.get(key)?.data as T | undefined;
}

export function clearStudyMemoryCache() {
  memory.clear();
  inflight.clear();
}

async function readPersisted(key: string): Promise<MemoryEntry | undefined> {
  if (!isOfflineStorageAvailable()) return undefined;
  try {
    const row = await idbGet<PersistedRow>("studyCache", key);
    if (!row) return undefined;
    return { data: JSON.parse(row.json), savedAt: row.savedAt };
  } catch {
    return undefined;
  }
}

function persist(key: string, data: unknown, savedAt: number) {
  if (!isOfflineStorageAvailable()) return;
  try {
    const row: PersistedRow = { key, json: JSON.stringify(data), savedAt };
    void idbPut("studyCache", row).catch(() => {
      // Quota or a blocked database — the memory copy still works.
    });
  } catch {
    // Not serializable — nothing worth keeping.
  }
}

const sameData = (a: unknown, b: unknown) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/**
 * One network fetch per key at a time: the tab that asks for a chapter while a
 * prefetch of it is already running joins that request instead of starting a
 * second. Resolves with the fresh data, or `undefined` when the fetch failed
 * (offline, expired session) — in which case whatever was cached stays.
 */
function fetchFresh<T>(key: string, fetcher: () => Promise<StudyResult<T>>): Promise<T | undefined> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T | undefined>;

  const request = (async () => {
    try {
      const result = await fetcher();
      if (result.error || result.data === undefined) return undefined;
      const savedAt = Date.now();
      remember(key, result.data, savedAt);
      persist(key, result.data, savedAt);
      return result.data;
    } catch {
      return undefined;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
}

/**
 * Delivers `key`'s data to `onData` as fast as it can: the memory copy, else
 * the IndexedDB copy, else the network — and, when what it delivered came from
 * a cache that may be old, calls `onData` once more if the server disagrees.
 *
 * `onData(undefined)` means there was nothing cached and the fetch failed.
 */
export function loadStudyData<T>(
  key: string,
  fetcher: () => Promise<StudyResult<T>>,
  onData: (data: T | undefined) => void
): void {
  const revalidate = (shown: T) => {
    void fetchFresh(key, fetcher).then((fresh) => {
      if (fresh !== undefined && !sameData(fresh, shown)) onData(fresh);
    });
  };

  const hit = memory.get(key);
  if (hit) {
    // Re-insert to mark it recently used.
    remember(key, hit.data, hit.savedAt);
    const shown = hit.data as T;
    queueMicrotask(() => onData(shown));
    if (Date.now() - hit.savedAt > REVALIDATE_AFTER_MS) revalidate(shown);
    return;
  }

  void (async () => {
    const stored = await readPersisted(key);
    if (stored) {
      remember(key, stored.data, stored.savedAt);
      const shown = stored.data as T;
      onData(shown);
      // First time this session — always check; it may have been re-imported since.
      revalidate(shown);
      return;
    }
    onData(await fetchFresh(key, fetcher));
  })();
}

/**
 * Warms a chapter nobody asked for yet (the next one) without painting anything.
 * Cheap when it is already cached; otherwise one quiet request.
 */
export function prefetchStudyData<T>(key: string, fetcher: () => Promise<StudyResult<T>>): void {
  if (memory.has(key) || inflight.has(key)) return;
  loadStudyData(key, fetcher, () => {});
}
