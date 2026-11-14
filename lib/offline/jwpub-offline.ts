import {
  getOfflineChapters,
  getOfflineFootnotes,
  getOfflineExtracts,
  getAnswers,
  type JwpubExtractRow,
} from "@/app/(app)/jwpub-actions";
import { getPublicationHighlights, type PublicationHighlight } from "@/app/(app)/jwlibrary-actions";
import type { ChapterSummary, PublicationSummary } from "@/lib/jwpub/types";
import {
  idbDelete,
  idbDeleteByPrefix,
  idbGet,
  idbGetAll,
  idbPut,
  idbPutMany,
  isOfflineStorageAvailable,
} from "./idb";
import { notifyInventoryChanged } from "./inventory-events";

/**
 * Whole publications kept on the device so they read with no connection.
 *
 * The reader's data comes from Server Actions, which the service worker can't
 * cache (they're POSTs), so a download copies everything the reader asks for
 * into IndexedDB and the reader looks there first. A row simply being present
 * is what "downloaded" means — callers never need a separate flag, and a
 * publication that was reprocessed (new publication id) just misses and falls
 * back to the server.
 */

/** Cache Storage bucket for a download's illustrations. Separate from the SW's own `supabase-public-media` cache, which expires entries after 200 and would evict a download. Mirrored by name in app/sw.ts. */
export const OFFLINE_MEDIA_CACHE = "jwpub-offline-media";

export interface OfflinePublication {
  noteId: string;
  publication: PublicationSummary;
  chapters: ChapterSummary[];
  downloadedAt: number;
  /** Approximate size on the device: stored text plus illustrations. */
  bytes: number;
  mediaUrls: string[];
  /** Illustrations that could not be fetched — the text is complete, those images will be missing offline. */
  mediaFailed: number;
}

interface MarksRow {
  key: string;
  highlights: PublicationHighlight[];
}

interface AnswersRow {
  publicationId: string;
  answers: Record<string, string>;
}

interface ChapterRow {
  publicationId: string;
  documentId: number;
  html: string;
}

interface FootnoteRow {
  publicationId: string;
  footnoteId: number;
  html: string;
}

type ExtractRow = JwpubExtractRow & { publicationId: string };

/** The `jwlibrary_*` rows are located by symbol + language + issue (never by publication id), so offline marks are keyed the same way. */
export function marksKey(symbol: string, mepsLanguage: number | null, issueTagNumber: number | null): string {
  return `${symbol}|${mepsLanguage ?? ""}|${issueTagNumber ?? ""}`;
}

export function publicationMarksKey(publication: PublicationSummary): string {
  return marksKey(publication.symbol, publication.mepsLanguageIndex, publication.issueTagNumber);
}

async function safely<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  if (!isOfflineStorageAvailable()) return fallback;
  try {
    return await run();
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** Fired once a download (or a re-download after a reprocess) has written a publication to the device, so open buttons re-read what is stored. */
export const OFFLINE_PUBLICATION_CHANGED_EVENT = "study-notes:offline-publication-changed";

export function getOfflinePublication(noteId: string): Promise<OfflinePublication | undefined> {
  return safely(undefined, () => idbGet<OfflinePublication>("publications", noteId));
}

export function listOfflinePublications(): Promise<OfflinePublication[]> {
  return safely([], () => idbGetAll<OfflinePublication>("publications"));
}

export function readOfflineChapter(publicationId: string, documentId: number): Promise<string | undefined> {
  return safely(undefined, async () => (await idbGet<ChapterRow>("chapters", [publicationId, documentId]))?.html);
}

export function readOfflineFootnote(publicationId: string, footnoteId: number): Promise<string | undefined> {
  return safely(undefined, async () => (await idbGet<FootnoteRow>("footnotes", [publicationId, footnoteId]))?.html);
}

/** In the order asked for; undefined when this publication has no local copy at all (so the caller goes to the server). */
export function readOfflineExtracts(publicationId: string, extractIds: number[]): Promise<JwpubExtractRow[] | undefined> {
  return safely(undefined, async () => {
    const rows = await Promise.all(extractIds.map((id) => idbGet<ExtractRow>("extracts", [publicationId, id])));
    const found = rows.filter((row): row is ExtractRow => row !== undefined);
    if (found.length === 0) return undefined;
    return found.map((row) => ({
      extractId: row.extractId,
      html: row.html,
      caption: row.caption,
      refTitle: row.refTitle,
      refSymbol: row.refSymbol,
      refMepsDocumentId: row.refMepsDocumentId,
    }));
  });
}

export function readOfflineAnswers(publicationId: string): Promise<Record<string, string> | undefined> {
  return safely(undefined, async () => (await idbGet<AnswersRow>("answers", publicationId))?.answers);
}

/** Highlights and notes for one chapter, or undefined when the publication has no local copy. */
export function readOfflineHighlights(
  publication: PublicationSummary,
  mepsDocumentId: number | null
): Promise<PublicationHighlight[] | undefined> {
  return safely(undefined, async () => {
    const row = await idbGet<MarksRow>("marks", publicationMarksKey(publication));
    if (!row) return undefined;
    return row.highlights.filter((h) => h.mepsDocumentId === mepsDocumentId);
  });
}

/* ------------------------------------------------------------------ *
 * Downloading
 * ------------------------------------------------------------------ */

const MEDIA_URL_RE = /https:\/\/[^"'\s)<>]+\/storage\/v1\/object\/public\/[^"'\s)<>]+/g;

function collectMediaUrls(html: string, into: Set<string>) {
  for (const match of html.matchAll(MEDIA_URL_RE)) into.add(match[0].replaceAll("&amp;", "&"));
}

async function fetchIntoMediaCache(urls: string[], onEach: () => void): Promise<{ bytes: number; failed: number }> {
  if (urls.length === 0 || typeof caches === "undefined") return { bytes: 0, failed: urls.length };
  const cache = await caches.open(OFFLINE_MEDIA_CACHE);
  let bytes = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      try {
        // Already kept by an earlier download.
        const existing = await cache.match(url);
        if (existing) {
          bytes += Number(existing.headers.get("content-length") ?? 0);
        } else {
          const response = await fetch(url, { mode: "cors" });
          if (!response.ok) throw new Error(String(response.status));
          bytes += Number(response.headers.get("content-length") ?? 0);
          await cache.put(url, response);
        }
      } catch {
        failed += 1;
      }
      onEach();
    }
  }

  await Promise.all(Array.from({ length: 4 }, worker));
  return { bytes, failed };
}

/**
 * Copies one publication — chapters, footnotes, embedded excerpts, the user's
 * answers, highlights and notes, and the illustrations — onto this device.
 * The publication row is written last, so an interrupted download leaves no
 * half-finished copy that would read as "downloaded". Throws on a network or
 * server failure, leaving any previous copy untouched.
 */
export async function downloadPublication(
  noteId: string,
  publication: PublicationSummary,
  chapters: ChapterSummary[],
  onProgress: (fraction: number, label: string) => void
): Promise<OfflinePublication> {
  const previous = await getOfflinePublication(noteId);
  const media = new Set<string>();
  let textChars = 0;

  // Weights of the phases in the progress bar; illustrations are most of the bytes.
  const CHAPTERS = 0.5;
  const REST = 0.1;

  // 1. Chapters, a few at a time.
  const pending = chapters.map((c) => c.documentId);
  let storedChapters = 0;
  while (pending.length > 0) {
    const result = await getOfflineChapters(publication.id, pending.slice(0, 8));
    if (result.error || !result.chapters || result.chapters.length === 0) {
      throw new Error(result.error ?? "Não foi possível baixar os capítulos.");
    }
    await idbPutMany(
      "chapters",
      result.chapters.map((c) => ({ publicationId: publication.id, documentId: c.documentId, html: c.html }) satisfies ChapterRow)
    );
    for (const c of result.chapters) {
      textChars += c.html.length;
      collectMediaUrls(c.html, media);
      pending.splice(pending.indexOf(c.documentId), 1);
    }
    storedChapters += result.chapters.length;
    onProgress((storedChapters / chapters.length) * CHAPTERS, "Capítulos");
  }

  // 2. Footnotes.
  let footnoteCursor: number | null = -1;
  while (footnoteCursor !== null) {
    const result = await getOfflineFootnotes(publication.id, footnoteCursor);
    if (result.error || !result.footnotes) throw new Error(result.error ?? "Não foi possível baixar as notas de rodapé.");
    await idbPutMany(
      "footnotes",
      result.footnotes.map((f) => ({ publicationId: publication.id, footnoteId: f.footnoteId, html: f.html }) satisfies FootnoteRow)
    );
    for (const f of result.footnotes) {
      textChars += f.html.length;
      collectMediaUrls(f.html, media);
    }
    footnoteCursor = result.nextCursor ?? null;
  }
  onProgress(CHAPTERS + REST * 0.4, "Notas de rodapé");

  // 3. Embedded excerpts.
  let extractCursor: number | null = -1;
  while (extractCursor !== null) {
    const result = await getOfflineExtracts(publication.id, extractCursor);
    if (result.error || !result.extracts) throw new Error(result.error ?? "Não foi possível baixar os trechos citados.");
    await idbPutMany(
      "extracts",
      result.extracts.map((e) => ({ ...e, publicationId: publication.id }) satisfies ExtractRow)
    );
    for (const e of result.extracts) {
      textChars += e.html.length + (e.caption?.length ?? 0);
      collectMediaUrls(e.html, media);
    }
    extractCursor = result.nextCursor ?? null;
  }
  onProgress(CHAPTERS + REST * 0.7, "Trechos citados");

  // 4. The user's own answers, highlights and notes.
  const [answers, highlights] = await Promise.all([
    getAnswers(publication.id),
    getPublicationHighlights(publication.symbol, publication.mepsLanguageIndex, publication.issueTagNumber),
  ]);
  if (answers.error || !answers.answers) throw new Error(answers.error ?? "Não foi possível baixar as respostas.");
  if (highlights.error || !highlights.highlights) throw new Error(highlights.error ?? "Não foi possível baixar as marcações.");
  await idbPut("answers", { publicationId: publication.id, answers: answers.answers } satisfies AnswersRow);
  await idbPut("marks", { key: publicationMarksKey(publication), highlights: highlights.highlights } satisfies MarksRow);
  onProgress(CHAPTERS + REST, "Marcações");

  // 5. Illustrations.
  const mediaUrls = [...media];
  let fetched = 0;
  const mediaResult = await fetchIntoMediaCache(mediaUrls, () => {
    fetched += 1;
    onProgress(CHAPTERS + REST + (fetched / mediaUrls.length) * (1 - CHAPTERS - REST), "Imagens");
  });

  const record: OfflinePublication = {
    noteId,
    publication,
    chapters,
    downloadedAt: Date.now(),
    // Stored text is UTF-16 in memory but mostly one byte per character on disk.
    bytes: textChars + mediaResult.bytes,
    mediaUrls,
    mediaFailed: mediaResult.failed,
  };
  await idbPut("publications", record);

  // A reprocess gives the publication a new id; the copy keyed by the old one is now unreachable.
  if (previous && previous.publication.id !== publication.id) {
    await idbDeleteByPrefix(["chapters", "footnotes", "extracts"], previous.publication.id);
    await idbDelete("answers", previous.publication.id);
  }

  try {
    // Asks the browser not to evict this under storage pressure; it may still decline.
    void navigator.storage?.persist?.();
  } catch {
    // Not supported.
  }

  notifyInventoryChanged();
  return record;
}

export async function removeOfflinePublication(noteId: string): Promise<void> {
  const record = await getOfflinePublication(noteId);
  if (!record) return;
  const id = record.publication.id;

  await idbDeleteByPrefix(["chapters", "footnotes", "extracts"], id);
  await idbDelete("answers", id);
  await idbDelete("marks", publicationMarksKey(record.publication));
  await idbDelete("publications", noteId);
  notifyInventoryChanged();

  // Illustrations another downloaded publication still uses stay.
  try {
    if (typeof caches !== "undefined") {
      const stillUsed = new Set((await listOfflinePublications()).flatMap((p) => p.mediaUrls));
      const cache = await caches.open(OFFLINE_MEDIA_CACHE);
      await Promise.all(record.mediaUrls.filter((url) => !stillUsed.has(url)).map((url) => cache.delete(url)));
    }
  } catch {
    // Best effort — leftover images only cost space.
  }
}

/** Re-reads the user's answers, highlights and notes from the server into every local copy. Chapter text is static, so only this moves. */
export async function refreshOfflineUserData(): Promise<void> {
  for (const record of await listOfflinePublications()) {
    const [answers, highlights] = await Promise.all([
      getAnswers(record.publication.id),
      getPublicationHighlights(
        record.publication.symbol,
        record.publication.mepsLanguageIndex,
        record.publication.issueTagNumber
      ),
    ]);
    if (answers.answers) await idbPut("answers", { publicationId: record.publication.id, answers: answers.answers });
    if (highlights.highlights) {
      await idbPut("marks", { key: publicationMarksKey(record.publication), highlights: highlights.highlights });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Local edits — applied to the downloaded copy as the user makes them, so
 * the reader (which reads from here) matches the outbox that will replay them.
 * ------------------------------------------------------------------ */

// Read-modify-write on one row: two edits in quick succession would otherwise both read the old row and the second would erase the first.
let localWrites: Promise<unknown> = Promise.resolve();
function serialized(run: () => Promise<void>): Promise<void> {
  const next = localWrites.then(run, run);
  localWrites = next.catch(() => undefined);
  return next;
}

function mutateMarks(change: (highlights: PublicationHighlight[]) => PublicationHighlight[] | null) {
  return serialized(() =>
    safely(undefined, async () => {
      for (const row of await idbGetAll<MarksRow>("marks")) {
        const next = change(row.highlights);
        if (next) await idbPut("marks", { key: row.key, highlights: next } satisfies MarksRow);
      }
    })
  );
}

export function localAddHighlight(
  location: { symbol: string; mepsLanguage: number | null; issueTagNumber: number | null },
  highlight: PublicationHighlight
) {
  return serialized(() =>
    safely(undefined, async () => {
      const key = marksKey(location.symbol, location.mepsLanguage, location.issueTagNumber);
      const row = await idbGet<MarksRow>("marks", key);
      if (!row) return;
      await idbPut("marks", { key, highlights: [...row.highlights.filter((h) => h.id !== highlight.id), highlight] });
    })
  );
}

export function localSetHighlightColor(id: string, colorIndex: number) {
  return mutateMarks((hs) => (hs.some((h) => h.id === id) ? hs.map((h) => (h.id === id ? { ...h, colorIndex } : h)) : null));
}

/** The server keeps a note whose highlight is deleted (it just loses the mark), so the note stays here as a loose one. */
export function localDeleteHighlight(id: string) {
  return mutateMarks((hs) => {
    const target = hs.find((h) => h.id === id);
    if (!target) return null;
    const rest = hs.filter((h) => h.id !== id);
    if (!target.note) return rest;
    return [
      ...rest,
      { ...target, id: `note:${target.note.id}`, colorIndex: null, startToken: null, endToken: null },
    ];
  });
}

export function localSetNote(highlightId: string, note: { id: string; title: string; content: string }) {
  return mutateMarks((hs) => (hs.some((h) => h.id === highlightId) ? hs.map((h) => (h.id === highlightId ? { ...h, note } : h)) : null));
}

export function localUpdateNote(noteId: string, patch: { title?: string; content?: string }) {
  return mutateMarks((hs) =>
    hs.some((h) => h.note?.id === noteId)
      ? hs.map((h) => (h.note?.id === noteId ? { ...h, note: { ...h.note, ...patch } } : h))
      : null
  );
}

export function localDeleteNote(noteId: string) {
  return mutateMarks((hs) => {
    if (!hs.some((h) => h.note?.id === noteId)) return null;
    // A loose note (no highlight behind it) is its whole entry; otherwise only the note goes.
    return hs.flatMap((h) => {
      if (h.note?.id !== noteId) return [h];
      return h.colorIndex === null ? [] : [{ ...h, note: null }];
    });
  });
}

export function localSaveAnswer(publicationId: string, documentId: number, pid: string, answer: string) {
  return serialized(() =>
    safely(undefined, async () => {
      const row = await idbGet<AnswersRow>("answers", publicationId);
      if (!row) return;
      await idbPut("answers", { publicationId, answers: { ...row.answers, [`${documentId}:${pid}`]: answer } });
    })
  );
}
