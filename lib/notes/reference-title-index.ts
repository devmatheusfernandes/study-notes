import {
  getReferenceTitleIndex,
  getReferenceTitleIndexVersion,
  type ReferenceTitleIndex,
} from "@/app/(app)/reference-index-actions";
import { searchNoteReferenceCandidates, type ChapterTitleHit } from "@/app/(app)/note-reference-search-actions";
import type { ReferenceSearchResults } from "@/lib/notes/reference-suggestions";
import { idbGet, idbPut, isOfflineStorageAvailable } from "@/lib/offline/idb";

/**
 * Local search over every chapter/article and video title the "@" menu can
 * cite (see app/(app)/reference-index-actions.ts for what's in it and why).
 *
 * Life cycle:
 *   - first "@" ever on this device: no index yet → fall back to the server
 *     search (exactly the old behaviour) while the index downloads in the
 *     background; from the next keystroke on, it's local.
 *   - later sessions: the copy in IndexedDB is loaded at once (so the very
 *     first "@" is already instant) and a cheap fingerprint check refreshes
 *     it if a publication was imported or the video catalogue grew.
 */

const CHAPTER_LIMIT = 5;
const VIDEO_LIMIT = 4;
const SCOPED_CHAPTER_LIMIT = 8;
/** Don't re-check the fingerprint more often than this while the user keeps opening the menu. */
const REVALIDATE_EVERY_MS = 60_000;

interface Prepared {
  index: ReferenceTitleIndex;
  /** Normalised titles, parallel to index.chapters / index.videos — computed once, not per keystroke. */
  chapterKeys: string[];
  videoKeys: string[];
}

let prepared: Prepared | null = null;
let loading: Promise<void> | null = null;
let lastCheckedAt = 0;

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function prepare(index: ReferenceTitleIndex): Prepared {
  return {
    index,
    chapterKeys: index.chapters.map((c) => normalize(c[2])),
    videoKeys: index.videos.map((v) => normalize(v[1])),
  };
}

async function loadFromDisk(): Promise<void> {
  if (prepared || !isOfflineStorageAvailable()) return;
  try {
    const row = await idbGet<{ key: "index"; index: ReferenceTitleIndex }>("referenceIndex", "index");
    if (row?.index && !prepared) prepared = prepare(row.index);
  } catch {
    // No stored copy — the server search covers it.
  }
}

async function refreshFromServer(): Promise<void> {
  const current = await getReferenceTitleIndexVersion();
  if (current.error || !current.version) return;
  if (prepared?.index.version === current.version) return;

  const fresh = await getReferenceTitleIndex();
  if (fresh.error || !fresh.index) return;
  prepared = prepare(fresh.index);
  if (isOfflineStorageAvailable()) {
    try {
      await idbPut("referenceIndex", { key: "index", index: fresh.index });
    } catch {
      // Memory copy still works for this session.
    }
  }
}

/** True once a local index is in memory — the editor then skips its debounce and "buscando…" row. */
export function isReferenceTitleIndexReady(): boolean {
  return prepared !== null;
}

/** Starts (once at a time) whatever loading/refreshing is due. Never throws; safe to call on every menu open. */
export function warmReferenceTitleIndex(): void {
  const now = Date.now();
  if (loading || (prepared && now - lastCheckedAt < REVALIDATE_EVERY_MS)) return;
  lastCheckedAt = now;
  loading = (async () => {
    await loadFromDisk();
    await refreshFromServer();
  })()
    .catch(() => {
      // Offline or signed out: keep whatever we have.
    })
    .finally(() => {
      loading = null;
    });
}

/** Ranks a title against the needle: starts-with beats word-start beats anywhere. -1 = no match. */
function rank(key: string, needle: string): number {
  if (key.startsWith(needle)) return 0;
  if (key.includes(` ${needle}`)) return 1;
  return key.includes(needle) ? 2 : -1;
}

function searchLocal(
  { index, chapterKeys, videoKeys }: Prepared,
  query: string,
  scopeSymbol?: string
): ReferenceSearchResults {
  const needle = normalize(query);
  const { publications, chapters, videos } = index;

  const toHit = (chapterIndex: number): ChapterTitleHit => {
    const [pubIndex, documentId, title] = chapters[chapterIndex];
    const pub = publications[pubIndex];
    return {
      source: pub.source,
      publicationId: pub.id,
      publicationTitle: pub.title,
      symbol: pub.symbol,
      documentId,
      chapterTitle: title,
      noteId: pub.noteId,
    };
  };

  if (scopeSymbol) {
    // Inside one named publication: chapters in their reading order (the index
    // is stored that way), optionally filtered. Own copies first, then global.
    const symbol = scopeSymbol.toLowerCase();
    const own: ChapterTitleHit[] = [];
    const global: ChapterTitleHit[] = [];
    for (let i = 0; i < chapters.length; i += 1) {
      const pub = publications[chapters[i][0]];
      if (pub.symbol !== symbol) continue;
      if (needle && !chapterKeys[i].includes(needle)) continue;
      (pub.source === "own" ? own : global).push(toHit(i));
    }
    const ownIds = new Set(own.map((h) => h.documentId));
    const hits = [...own, ...global.filter((h) => !ownIds.has(h.documentId))].slice(0, SCOPED_CHAPTER_LIMIT);
    return { chapters: hits, videos: [] };
  }

  if (needle.length < 2) return { chapters: [], videos: [] };

  const scored: { i: number; score: number; own: boolean }[] = [];
  for (let i = 0; i < chapters.length; i += 1) {
    const score = rank(chapterKeys[i], needle);
    if (score >= 0) scored.push({ i, score, own: publications[chapters[i][0]].source === "own" });
  }
  // Own publications first (what the user actually has), then best title match, then reading order.
  scored.sort((a, b) => Number(b.own) - Number(a.own) || a.score - b.score || a.i - b.i);

  const own = scored.filter((s) => s.own).map((s) => toHit(s.i));
  const ownIds = new Set(own.map((h) => h.documentId));
  const global = scored
    .filter((s) => !s.own)
    .map((s) => toHit(s.i))
    .filter((h) => !ownIds.has(h.documentId));

  const foundVideos: { i: number; score: number }[] = [];
  for (let i = 0; i < videos.length; i += 1) {
    const score = rank(videoKeys[i], needle);
    if (score >= 0) foundVideos.push({ i, score });
  }
  foundVideos.sort((a, b) => a.score - b.score || a.i - b.i);

  return {
    chapters: [...own, ...global].slice(0, CHAPTER_LIMIT),
    videos: foundVideos.slice(0, VIDEO_LIMIT).map(({ i }) => ({ videoId: videos[i][0], title: videos[i][1] })),
  };
}

/**
 * Drop-in replacement for `searchNoteReferenceCandidates` in the "@" menu:
 * answers from the local index when there is one, otherwise from the server.
 */
export async function searchReferenceTitles(
  query: string,
  options?: { publicationSymbol?: string }
): Promise<ReferenceSearchResults> {
  warmReferenceTitleIndex();
  if (!prepared) await loadFromDisk();
  if (prepared) return searchLocal(prepared, query, options?.publicationSymbol);

  try {
    return await searchNoteReferenceCandidates(query, options);
  } catch {
    return { chapters: [], videos: [] }; // offline and nothing downloaded yet
  }
}
