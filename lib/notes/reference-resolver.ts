/**
 * Resolving an in-note reference ("(mt 7:12)", "(th 2)", a video, a linked
 * note) to the content its side panel shows — plus the session cache in front
 * of it.
 *
 * Split out of components/content/note-reference-surface.tsx so the editor can
 * warm a reference before it's clicked (see `prefetchNoteReference`, wired to
 * hover in rich-text-editor.tsx) without importing the panel.
 *
 * Why a cache at all: every resolution here is a Server Action, and Next
 * dispatches Server Actions **one at a time per client** (see
 * node_modules/next/dist/docs/01-app/02-guides/server-actions.md, "Sequential
 * dispatch on the client"), each carrying its own `supabase.auth.getUser()`
 * round trip. Re-resolving a reference the user already opened therefore isn't
 * just a wasted query, it's a wasted slot in a queue that everything else in
 * the note is waiting behind.
 */

import {
  getBibleChapterVerses,
  getBibleVerseRange,
  getBibleVerses,
  type BibleVerseRow,
} from "@/app/(app)/bible-actions";
import {
  resolveJwpubReferences,
  resolvePublicationChapterById,
  resolvePublicationReference,
} from "@/app/(app)/jwpub-actions";
import { loadChapter, loadExtracts } from "@/lib/offline/jwpub-data";
import type { JwpubExtractItem } from "@/components/content/jwpub-extract-surface";
import { getGlobalVideoById } from "@/app/(app)/global-video-actions";
import { referenceFromElement, referenceKey, type NoteReference } from "@/lib/notes/note-reference";
import { readOfflineBibleByIds, readOfflineBibleChapter, readOfflineBibleRange } from "@/lib/offline/bible-offline";

/** A publication chapter, in the shape JwpubReferenceSurface's `target` wants. */
export interface ResolvedPublicationTarget {
  noteId: string | null;
  publicationTitle: string;
  chapterTitle: string;
  documentId: number;
}

/** A video, in the shape NoteVideoSurface's `video` wants. */
export interface ResolvedVideoTarget {
  videoId: string;
  title: string;
  videoUrl?: string;
  coverImage?: string;
  durationFormatted?: string;
  subtitlesUrl?: string;
}

export interface ResolvedReference {
  verses: BibleVerseRow[] | null;
  target: ResolvedPublicationTarget | null;
  html: string | null;
  video: ResolvedVideoTarget | null;
  /** Excerpts embedded in a .jwpub, for a pasted "extract" citation. */
  extracts: JwpubExtractItem[] | null;
  /** A pasted citation into a publication that isn't in the library — the panel offers "Baixar" for it. */
  unresolvedMepsDocumentId: number | null;
  error: string | null;
}

const EMPTY: ResolvedReference = {
  verses: null,
  target: null,
  html: null,
  video: null,
  extracts: null,
  unresolvedMepsDocumentId: null,
  error: null,
};

/**
 * Module-level on purpose: it outlives the panel and is shared across every
 * note opened in the session.
 *
 * Only *successful* resolutions are stored. An error here is either transient
 * (offline, expired session) or something the user can fix without reloading
 * (uploading the publication the reference points at), so caching it would
 * leave the panel insisting a reference is broken after it stopped being.
 */
const cache = new Map<string, ResolvedReference>();

/** In-flight resolutions, so hover-prefetch and the click that follows it share one request instead of queueing two. */
const inFlight = new Map<string, Promise<ResolvedReference>>();

/** The cached resolution for a reference, or `undefined` if it hasn't been resolved yet. */
export function cachedNoteReference(reference: NoteReference | null): ResolvedReference | undefined {
  if (!reference || reference.kind === "note") return undefined;
  return cache.get(referenceKey(reference));
}

async function fetchReference(reference: NoteReference): Promise<ResolvedReference> {
  if (reference.kind === "note") return EMPTY; // read straight from the notes store, never fetched

  if (reference.kind === "bible") {
    // Downloaded Bible → answer from the device, no Server Action, no queue.
    const local =
      reference.startVerse === null
        ? await readOfflineBibleChapter(reference.bookOrder, reference.chapter)
        : await readOfflineBibleRange(reference.bookOrder, reference.chapter, reference.startVerse, reference.endVerse);
    if (local) return { ...EMPTY, verses: local };

    const result =
      reference.startVerse === null
        ? await getBibleChapterVerses(reference.bookOrder, reference.chapter)
        : await getBibleVerseRange(reference.bookOrder, reference.chapter, reference.startVerse, reference.endVerse);
    return { ...EMPTY, verses: result.verses ?? null, error: result.error ?? null };
  }

  if (reference.kind === "verses") {
    const local = await readOfflineBibleByIds(reference.firstVerseId, reference.lastVerseId);
    if (local) return { ...EMPTY, verses: local };
    const result = await getBibleVerses(reference.firstVerseId, reference.lastVerseId);
    return { ...EMPTY, verses: result.verses ?? null, error: result.error ?? null };
  }

  if (reference.kind === "extract") {
    const result = await loadExtracts(reference.publicationId, reference.extractIds);
    if (result.error) return { ...EMPTY, error: result.error };
    return { ...EMPTY, extracts: result.extracts ?? [] };
  }

  if (reference.kind === "pubref") {
    const { resolved } = await resolveJwpubReferences([reference.mepsDocumentId]);
    const hit = resolved[0];
    // Not in the library: not an error and not cached (see below) — the panel
    // offers a download, after which a click resolves for real.
    if (!hit) return { ...EMPTY, unresolvedMepsDocumentId: reference.mepsDocumentId };
    const html = hit.contentHtml ?? (await loadChapter(hit.publicationId, hit.documentId)).html ?? null;
    if (html === null) return { ...EMPTY, error: "Não foi possível carregar o trecho." };
    return {
      ...EMPTY,
      target: {
        noteId: hit.noteId,
        publicationTitle: hit.publicationTitle,
        chapterTitle: hit.chapterTitle,
        documentId: hit.documentId,
      },
      html,
    };
  }

  if (reference.kind === "video") {
    const row = await getGlobalVideoById(reference.videoId);
    if (!row) return { ...EMPTY, error: "Vídeo não encontrado." };
    return {
      ...EMPTY,
      video: {
        videoId: row.id,
        title: row.title,
        videoUrl: row.video_url ?? undefined,
        coverImage: row.cover_image ?? undefined,
        durationFormatted: row.duration_formatted ?? undefined,
        subtitlesUrl: row.subtitles_url ?? undefined,
      },
    };
  }

  const { reference: resolved, error } =
    reference.documentId !== undefined && reference.publicationId
      ? await resolvePublicationChapterById(reference.publicationId, reference.documentId, !!reference.isGlobal)
      : await resolvePublicationReference(reference.symbol, reference.chapter);

  if (!resolved) return { ...EMPTY, error: error ?? "Referência não encontrada." };

  return {
    ...EMPTY,
    target: {
      noteId: resolved.noteId,
      publicationTitle: resolved.publicationTitle,
      chapterTitle: resolved.chapterTitle,
      documentId: resolved.documentId,
    },
    html: resolved.html,
  };
}

/**
 * Resolves a reference, going through the cache and de-duplicating concurrent
 * callers. Rejections propagate (offline) rather than being cached as an
 * error, so the next click retries.
 */
export function resolveNoteReference(reference: NoteReference): Promise<ResolvedReference> {
  const key = referenceKey(reference);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = fetchReference(reference)
    .then((resolved) => {
      if (resolved.error === null && resolved.unresolvedMepsDocumentId === null) cache.set(key, resolved);
      return resolved;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

/**
 * Warms a reference without caring about the result — called on hover, so the
 * click that follows finds it in the cache and paints immediately. Swallows
 * failures: a prefetch that can't reach the server (offline) must never
 * surface anything, the click itself will report it.
 */
export function prefetchNoteReference(reference: NoteReference): void {
  if (reference.kind === "note") return;
  void resolveNoteReference(reference).catch(() => {});
}

/** Most references warmed per pass — each is a Server Action, and those queue one at a time behind the note's own saves. */
const WARM_LIMIT = 12;

/**
 * Resolves, ahead of any click, the citations pasted from a .jwpub reader that
 * a note body contains (extracts, scripture ids, publication pointers). Run
 * once the note is open and after edits settle: by the time one is clicked its
 * content is already in the cache and the panel paints in the same frame.
 *
 * One at a time, and never throws. Anything already cached or in flight is a
 * no-op, so calling this repeatedly is cheap. Typed "(mt 7:12)" references are
 * left to the hover prefetch — they're plentiful and cheap to fetch on demand.
 */
export async function warmPastedReferences(root: HTMLElement): Promise<void> {
  const elements = root.querySelectorAll("[data-note-ref=extract], [data-note-ref=verses], [data-note-ref=pubref]");
  const seen = new Set<string>();
  const pending: NoteReference[] = [];
  for (const element of elements) {
    const reference = referenceFromElement(element);
    if (!reference) continue;
    const key = referenceKey(reference);
    if (seen.has(key) || cache.has(key)) continue;
    seen.add(key);
    pending.push(reference);
    if (pending.length >= WARM_LIMIT) break;
  }
  for (const reference of pending) {
    try {
      await resolveNoteReference(reference);
    } catch {
      // offline or transient — the click itself reports it
    }
  }
}
