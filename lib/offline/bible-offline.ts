import { getBibleChapterVerses, getBibleDownloadSlice, type BibleVerseRow } from "@/app/(app)/bible-actions";
import { idbClear, idbGet, idbGetAll, idbPut, idbPutMany, isOfflineStorageAvailable } from "./idb";

/**
 * The whole Bible (public.bible_verses, ~31k rows) kept on the device so a
 * verse lookup is a local IndexedDB read instead of a Server Action.
 *
 * Stored one row per chapter ({ bookOrder, chapter, verses }) — 1.189 rows
 * rather than 31k — because every lookup the app makes is "this chapter" or
 * "this verse range inside a chapter", never a single verse by id. The "complete"
 * marker row is written LAST, so an interrupted download never reads as
 * downloaded (same rule as the publication downloads).
 *
 * Dropped with the rest of the offline database on sign-out.
 */

interface BibleChapterRow {
  bookOrder: number;
  chapter: number;
  verses: BibleVerseRow[];
}

interface BibleMetaRow {
  key: "complete";
  downloadedAt: number;
  verseCount: number;
  bytes: number;
}

export interface BibleOfflineInfo {
  downloadedAt: number;
  verseCount: number;
  bytes: number;
}

/** `undefined` = not looked up yet. Avoids hitting IndexedDB just to learn "no" on every reference. */
let downloaded: boolean | undefined;

export async function getBibleOfflineInfo(): Promise<BibleOfflineInfo | null> {
  if (!isOfflineStorageAvailable()) return null;
  try {
    const meta = await idbGet<BibleMetaRow>("bibleMeta", "complete");
    downloaded = !!meta;
    return meta ? { downloadedAt: meta.downloadedAt, verseCount: meta.verseCount, bytes: meta.bytes } : null;
  } catch {
    return null;
  }
}

async function isDownloaded(): Promise<boolean> {
  if (downloaded === undefined) await getBibleOfflineInfo();
  return downloaded === true;
}

/** All verses of a chapter from the device, or `undefined` when the Bible isn't downloaded (caller falls back to the server). */
export async function readOfflineBibleChapter(bookOrder: number, chapter: number): Promise<BibleVerseRow[] | undefined> {
  try {
    if (!(await isDownloaded())) return undefined;
    const row = await idbGet<BibleChapterRow>("bibleChapters", [bookOrder, chapter]);
    return row?.verses;
  } catch {
    return undefined;
  }
}

/**
 * Local-first chapter load for the /bible reader: the device copy when the
 * Bible is downloaded, else the server — and a failure to reach it (offline)
 * comes back as an `error` rather than an unhandled rejection.
 */
export async function loadBibleChapterVerses(
  bookOrder: number,
  chapter: number
): Promise<{ verses?: BibleVerseRow[]; error?: string }> {
  const local = await readOfflineBibleChapter(bookOrder, chapter);
  if (local) return { verses: local };
  try {
    return await getBibleChapterVerses(bookOrder, chapter);
  } catch {
    return { error: "Sem conexão. Baixe a Bíblia em Configurações para ler offline." };
  }
}

/** Mirrors getBibleVerseRange: a single verse when `endVerse` is null, else start..end inclusive. */
export async function readOfflineBibleRange(
  bookOrder: number,
  chapter: number,
  startVerse: number,
  endVerse: number | null
): Promise<BibleVerseRow[] | undefined> {
  const verses = await readOfflineBibleChapter(bookOrder, chapter);
  if (!verses) return undefined;
  const last = endVerse ?? startVerse;
  const slice = verses.filter((v) => v.verse !== null && v.verse >= startVerse && v.verse <= last);
  // Empty = a verse number the chapter doesn't have; let the server say so rather than guess.
  return slice.length > 0 ? slice : undefined;
}

/** Chapters in verse-id order, built once from the device copy — a `BibleVerseId` is sequential, so a range maps to the chapters it overlaps. */
let idIndex: Promise<{ first: number; last: number; verses: BibleVerseRow[] }[]> | undefined;

function buildIdIndex() {
  idIndex ??= idbGetAll<BibleChapterRow>("bibleChapters").then((rows) =>
    rows
      .filter((row) => row.verses.length > 0)
      .map((row) => ({ first: row.verses[0].id, last: row.verses[row.verses.length - 1].id, verses: row.verses }))
      .sort((a, b) => a.first - b.first)
  );
  return idIndex;
}

/**
 * Verses by `BibleVerseId` range — what a citation pasted from a .jwpub reader
 * carries (it names ids, not book/chapter/verse). `undefined` when the Bible
 * isn't downloaded or the range isn't found, so the caller asks the server.
 */
export async function readOfflineBibleByIds(firstVerseId: number, lastVerseId: number): Promise<BibleVerseRow[] | undefined> {
  try {
    if (!(await isDownloaded())) return undefined;
    const index = await buildIdIndex();
    const out: BibleVerseRow[] = [];
    for (const chapter of index) {
      if (chapter.last < firstVerseId || chapter.first > lastVerseId) continue;
      for (const verse of chapter.verses) if (verse.id >= firstVerseId && verse.id <= lastVerseId) out.push(verse);
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export async function downloadBible(onProgress?: (fraction: number) => void): Promise<{ error?: string }> {
  if (!isOfflineStorageAvailable()) return { error: "Este navegador não permite salvar dados no aparelho." };
  idIndex = undefined;

  // The Bible is 31.194 verses; used only to scale the progress bar, so being off by a few is harmless.
  const EXPECTED_VERSES = 31200;
  const chapters = new Map<string, BibleChapterRow>();
  let afterId = 0;
  let total = 0;
  let bytes = 0;

  try {
    for (;;) {
      const slice = await getBibleDownloadSlice(afterId);
      if (slice.error || !slice.verses) return { error: slice.error ?? "Falha ao baixar a Bíblia." };

      for (const verse of slice.verses) {
        const key = `${verse.bookOrder}:${verse.chapter}`;
        let row = chapters.get(key);
        if (!row) {
          row = { bookOrder: verse.bookOrder, chapter: verse.chapter, verses: [] };
          chapters.set(key, row);
        }
        row.verses.push(verse);
        bytes += (verse.text?.length ?? 0) + 40;
      }

      total += slice.verses.length;
      if (slice.verses.length > 0) afterId = slice.verses[slice.verses.length - 1].id;
      onProgress?.(Math.min(0.95, total / EXPECTED_VERSES));
      if (slice.done || slice.verses.length === 0) break;
    }

    if (total === 0) return { error: "A Bíblia não está disponível no servidor." };

    await idbClear(["bibleChapters", "bibleMeta"]);
    const rows = Array.from(chapters.values());
    for (let i = 0; i < rows.length; i += 200) await idbPutMany("bibleChapters", rows.slice(i, i + 200));
    await idbPut("bibleMeta", { key: "complete", downloadedAt: Date.now(), verseCount: total, bytes } satisfies BibleMetaRow);

    downloaded = true;
    onProgress?.(1);
    return {};
  } catch {
    return { error: "Não foi possível baixar a Bíblia. Verifique a conexão e tente de novo." };
  }
}

export async function removeOfflineBible(): Promise<void> {
  await idbClear(["bibleChapters", "bibleMeta"]);
  idIndex = undefined;
  downloaded = false;
}
