/**
 * In-note references: the "(mt 7:12)" / "(th 2)" the user types inside a note
 * body, and how that survives a round trip through `notes.body` HTML.
 *
 * Two kinds share one Tiptap mark (see lib/tiptap/note-reference-mark.ts):
 *   - `bible`       → resolved against public.bible_verses
 *   - `publication` → resolved against the caller's own ingested .jwpub files
 *
 * Parsing is synchronous and offline because it runs inside an input rule on
 * every closing parenthesis; the *resolution* (fetching the actual text) is
 * deferred to click time, so a reference to a publication uploaded later
 * starts working retroactively — the same dynamic-resolution reasoning as
 * resolveJwpubReferences in app/(app)/jwpub-actions.ts.
 */

import {
  BIBLE_BOOK_NAMES_PT,
  formatBibleReference,
  parseBibleReference,
  type ParsedBibleReference,
} from "@/lib/bible/parse-reference";

export interface ParsedPublicationReference {
  kind: "publication";
  /** The .jwpub key symbol, lowercased — "th", "bt", "lff", "it-1". */
  symbol: string;
  /** Chapter/lesson number as written, or `null` for a bare "(th)" meaning the publication itself. */
  chapter: number | null;
  /**
   * Set only when the "@" menu resolved this to one exact chapter via a
   * title search (see searchNoteReferenceCandidates) — resolution then
   * fetches this id directly instead of matching `chapter` against a
   * chapter's title/position, which is what symbol+number references still
   * do. `publicationId` is required alongside it to avoid a second lookup by
   * symbol at resolve time.
   */
  documentId?: number;
  publicationId?: string;
  /** True when `documentId`/`publicationId` point into `global_publication_chapters` rather than the user's own `jwpub_chapters`. */
  isGlobal?: boolean;
}

export interface ParsedVideoReference {
  kind: "video";
  videoId: string;
  /** Chip label shown before the panel re-fetches the real title. */
  title: string;
}

export interface ParsedNoteReference {
  kind: "note";
  noteId: string;
  /** Chip label — unlike the other kinds, the panel doesn't re-fetch this from a server, so it's also what's shown if the note is later renamed. */
  title: string;
}

export type NoteReference =
  | ParsedBibleReference
  | ParsedPublicationReference
  | ParsedVideoReference
  | ParsedNoteReference;

/** The character that opens the reference menu — kept in one place since the editor inserts it literally when completing a "prefix" row. */
export const NOTE_REFERENCE_TRIGGER = "@";

/**
 * "th 2", "th cap. 2", "bt lição 5", "lff 10", or a bare "th".
 *
 * The connector words are optional noise people write naturally; the symbol
 * and the number are the only parts that carry meaning.
 */
const PUBLICATION_PATTERN =
  /^([a-z][a-z0-9]{0,6}(?:-\d{1,2})?)\s*(?:cap\.?|cap[íi]tulo|li[çc][ãa]o|estudo|parte|artigo|se[çc][ãa]o)?\s*(\d{1,3})?$/i;

/**
 * A publication reference is only recognised when the symbol is actually in
 * `knownSymbols` (the caller's own library — see listPublicationSymbols).
 *
 * Without that check, ordinary prose in parentheses ("(ok 2)", "(nota 3)")
 * would get marked up as a reference that can never resolve. Requiring a real
 * publication means a chip appears only where clicking it will do something.
 */
export function parsePublicationReference(
  raw: string,
  knownSymbols: ReadonlySet<string>
): ParsedPublicationReference | null {
  const match = PUBLICATION_PATTERN.exec(raw.trim());
  if (!match) return null;

  const symbol = match[1].toLowerCase();
  if (!knownSymbols.has(symbol)) return null;

  const chapter = match[2] ? Number(match[2]) : null;
  if (chapter !== null && (!Number.isFinite(chapter) || chapter < 1)) return null;

  return { kind: "publication", symbol, chapter };
}

/**
 * Bible first: a Bible book name always wins over a publication symbol that
 * happens to look the same, since the canon is the more likely intent and is
 * the same for every user (a publication symbol depends on what they uploaded).
 */
export function parseNoteReference(
  raw: string,
  knownSymbols: ReadonlySet<string> = new Set()
): NoteReference | null {
  return parseBibleReference(raw) ?? parsePublicationReference(raw, knownSymbols);
}

/** What the chip shows once resolved — publications keep the raw symbol until the panel knows the real title. */
export function formatNoteReference(ref: NoteReference): string {
  if (ref.kind === "bible") return formatBibleReference(ref);
  if (ref.kind === "video" || ref.kind === "note") return ref.title;
  return ref.chapter === null
    ? ref.symbol.toUpperCase()
    : `${ref.symbol.toUpperCase()} ${ref.chapter}`;
}

/* ------------------------------------------------------------------ *
 * HTML round trip
 *
 * Stored as discrete `data-*` attributes rather than a JSON blob so the
 * markup stays readable/greppable and so anything that only reads the body as
 * text (card previews, vectorization) still sees the plain "(mt 7:12)" the
 * user typed.
 * ------------------------------------------------------------------ */

export const REFERENCE_ATTRIBUTE = "data-note-ref";

export type NoteReferenceAttributes = {
  kind: "bible" | "publication" | "video" | "note" | null;
  bookOrder: number | null;
  chapter: number | null;
  startVerse: number | null;
  endVerse: number | null;
  symbol: string | null;
  documentId: number | null;
  publicationId: string | null;
  isGlobal: boolean | null;
  videoId: string | null;
  linkedNoteId: string | null;
};

export function referenceToAttributes(ref: NoteReference): NoteReferenceAttributes {
  if (ref.kind === "bible") {
    return {
      kind: "bible",
      bookOrder: ref.bookOrder,
      chapter: ref.chapter,
      startVerse: ref.startVerse,
      endVerse: ref.endVerse,
      symbol: null,
      documentId: null,
      publicationId: null,
      isGlobal: null,
      videoId: null,
      linkedNoteId: null,
    };
  }
  if (ref.kind === "video") {
    return {
      kind: "video",
      bookOrder: null,
      chapter: null,
      startVerse: null,
      endVerse: null,
      symbol: null,
      documentId: null,
      publicationId: null,
      isGlobal: null,
      videoId: ref.videoId,
      linkedNoteId: null,
    };
  }
  if (ref.kind === "note") {
    return {
      kind: "note",
      bookOrder: null,
      chapter: null,
      startVerse: null,
      endVerse: null,
      symbol: null,
      documentId: null,
      publicationId: null,
      isGlobal: null,
      videoId: null,
      linkedNoteId: ref.noteId,
    };
  }
  return {
    kind: "publication",
    bookOrder: null,
    chapter: ref.chapter,
    startVerse: null,
    endVerse: null,
    symbol: ref.symbol,
    documentId: ref.documentId ?? null,
    publicationId: ref.publicationId ?? null,
    isGlobal: ref.isGlobal ?? null,
    videoId: null,
    linkedNoteId: null,
  };
}

function toNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Rebuilds a reference from a rendered `<span data-note-ref="…">`. Returns
 * `null` for a malformed one (hand-edited HTML, a body written by an older
 * version) — the caller then just ignores the click instead of opening an
 * empty panel.
 */
export function referenceFromElement(element: Element): NoteReference | null {
  const kind = element.getAttribute(REFERENCE_ATTRIBUTE);

  if (kind === "bible") {
    const bookOrder = toNumber(element.getAttribute("data-ref-book"));
    const chapter = toNumber(element.getAttribute("data-ref-chapter"));
    if (bookOrder === null || chapter === null) return null;
    return {
      kind: "bible",
      bookOrder,
      // The panel re-labels itself from the rows it fetches, so the name
      // baked into the markup is only a fallback for the header.
      book: element.getAttribute("data-ref-book-name") ?? "",
      chapter,
      startVerse: toNumber(element.getAttribute("data-ref-verse")),
      endVerse: toNumber(element.getAttribute("data-ref-verse-end")),
    };
  }

  if (kind === "publication") {
    const symbol = element.getAttribute("data-ref-symbol");
    if (!symbol) return null;
    const documentId = toNumber(element.getAttribute("data-ref-document-id"));
    const publicationId = element.getAttribute("data-ref-publication-id");
    return {
      kind: "publication",
      symbol: symbol.toLowerCase(),
      chapter: toNumber(element.getAttribute("data-ref-chapter")),
      documentId: documentId ?? undefined,
      publicationId: publicationId ?? undefined,
      isGlobal: element.getAttribute("data-ref-global") === "1",
    };
  }

  if (kind === "video") {
    const videoId = element.getAttribute("data-ref-video-id");
    if (!videoId) return null;
    return { kind: "video", videoId, title: element.textContent?.trim() ?? "Vídeo" };
  }

  if (kind === "note") {
    const noteId = element.getAttribute("data-ref-note-id");
    if (!noteId) return null;
    return { kind: "note", noteId, title: element.textContent?.trim() ?? "Nota" };
  }

  return null;
}

/** Stable identity for a reference — lets the panel skip a refetch when the same chip is clicked twice. */
export function referenceKey(ref: NoteReference): string {
  if (ref.kind === "bible") {
    return `bible:${ref.bookOrder}:${ref.chapter}:${ref.startVerse ?? ""}:${ref.endVerse ?? ""}`;
  }
  if (ref.kind === "video") return `video:${ref.videoId}`;
  if (ref.kind === "note") return `note:${ref.noteId}`;
  return `pub:${ref.symbol}:${ref.chapter ?? ""}:${ref.documentId ?? ""}`;
}

/**
 * The exact attribute set the Tiptap mark stores. Shared by the two places a
 * reference can be created — the "(…)" input rule and the "/" menu — so both
 * produce identical markup.
 */
export function referenceToMarkAttributes(ref: NoteReference): Record<string, unknown> {
  return {
    ...referenceToAttributes(ref),
    bookName: ref.kind === "bible" ? BIBLE_BOOK_NAMES_PT[ref.bookOrder] ?? null : null,
  };
}
