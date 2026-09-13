/**
 * Turns what the user has typed after "/" into the rows the reference menu
 * shows.
 *
 * Two row shapes, because naming a reference is two steps for anything but
 * the shortest abbreviation:
 *   - `insert` — the query already parses, so this row commits it.
 *   - `prefix` — the query names a book/publication but has no chapter yet,
 *     so this row completes the name and leaves the menu open to keep typing.
 */

import {
  BIBLE_BOOK_NAMES_PT,
  formatBibleReference,
  parseBibleReference,
} from "@/lib/bible/parse-reference";
import { BIBLE_BOOK_ABBREVIATIONS_PT } from "@/lib/bible/book-abbreviations";
import { parseNoteReference, type NoteReference } from "./note-reference";
import type { ChapterTitleHit, VideoTitleHit } from "@/app/(app)/note-reference-search-actions";

export interface PublicationOption {
  symbol: string;
  title: string;
}

/** One of the user's own notes, offered for "@" linking — see NoteReferenceSuggestions in note-editor.tsx. */
export interface NoteOption {
  id: string;
  title: string;
}

/** The async half of a search — chapter/article and video title hits, fetched via searchNoteReferenceCandidates. */
export interface ReferenceSearchResults {
  chapters: ChapterTitleHit[];
  videos: VideoTitleHit[];
}

const EMPTY_SEARCH_RESULTS: ReferenceSearchResults = { chapters: [], videos: [] };

export type ReferenceSuggestionItem =
  | {
      type: "insert";
      label: string;
      hint: string;
      /** Literal text written into the note, parentheses included. */
      text: string;
      reference: NoteReference;
    }
  | {
      type: "prefix";
      label: string;
      hint: string;
      /** Replaces the query and keeps the menu open, so the user types the chapter next. */
      text: string;
    };

const MAX_ITEMS = 7;

function normalizeForSearch(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** The name part of a half-typed reference — "mt 7:1" is still the user naming Matthew. */
export function namePartOf(query: string): string {
  return query.replace(/[\d\s:.\-–—]+$/u, "").trim();
}

export function buildReferenceSuggestions(
  query: string,
  publications: PublicationOption[],
  notes: NoteOption[] = [],
  search: ReferenceSearchResults = EMPTY_SEARCH_RESULTS
): ReferenceSuggestionItem[] {
  const items: ReferenceSuggestionItem[] = [];
  const trimmed = query.trim();
  const symbols = new Set(publications.map((p) => p.symbol));

  // A fully-formed query gets a commit row at the top, but the name rows stay
  // below it: "sal 23" parses, yet the user may still have meant to keep
  // typing "sal 23:1".
  const parsed = trimmed ? parseNoteReference(trimmed, symbols) : null;
  if (parsed) {
    if (parsed.kind === "bible") {
      items.push({
        type: "insert",
        label: formatBibleReference(parsed),
        hint: "Bíblia",
        text: `(${formatBibleReference(parsed)})`,
        reference: parsed,
      });
    } else if (parsed.kind === "publication") {
      const publication = publications.find((p) => p.symbol === parsed.symbol);
      items.push({
        type: "insert",
        label:
          parsed.chapter === null
            ? publication?.title ?? parsed.symbol.toUpperCase()
            : `${publication?.title ?? parsed.symbol.toUpperCase()} — ${parsed.chapter}`,
        hint: "Publicação",
        text: parsed.chapter === null ? `(${parsed.symbol})` : `(${parsed.symbol} ${parsed.chapter})`,
        reference: parsed,
      });
    }
  }

  const needle = normalizeForSearch(namePartOf(trimmed) || trimmed);

  // With nothing typed yet, the useful list is the user's own publications —
  // those are the names nobody remembers. All 66 Bible books would just be noise.
  if (!needle) {
    for (const publication of publications.slice(0, MAX_ITEMS)) {
      items.push({
        type: "prefix",
        label: publication.title || publication.symbol.toUpperCase(),
        hint: publication.symbol.toUpperCase(),
        text: `${publication.symbol} `,
      });
    }
    return items.slice(0, MAX_ITEMS);
  }

  for (let bookOrder = 1; bookOrder <= 66 && items.length < MAX_ITEMS; bookOrder += 1) {
    const name = BIBLE_BOOK_NAMES_PT[bookOrder];
    const abbreviation = BIBLE_BOOK_ABBREVIATIONS_PT[bookOrder] ?? "";
    const haystacks = [normalizeForSearch(name), normalizeForSearch(abbreviation)];
    if (!haystacks.some((h) => h.startsWith(needle) || h.replace(/\s+/g, "").startsWith(needle))) {
      continue;
    }
    // Skip the book the commit row above already covers.
    if (parsed?.kind === "bible" && parsed.bookOrder === bookOrder && parseBibleReference(trimmed)) {
      continue;
    }
    items.push({
      type: "prefix",
      label: name,
      hint: "Bíblia",
      text: `${name} `,
    });
  }

  for (const publication of publications) {
    if (items.length >= MAX_ITEMS) break;
    const haystacks = [normalizeForSearch(publication.symbol), normalizeForSearch(publication.title)];
    if (!haystacks.some((h) => h.startsWith(needle) || h.includes(needle))) continue;
    if (parsed?.kind === "publication" && parsed.symbol === publication.symbol) continue;
    items.push({
      type: "prefix",
      label: publication.title || publication.symbol.toUpperCase(),
      hint: publication.symbol.toUpperCase(),
      text: `${publication.symbol} `,
    });
  }

  // Own notes, matched by title — a ready-to-insert row (not "prefix"): a
  // note doesn't have a chapter/verse to keep typing after choosing it.
  for (const note of notes) {
    if (items.length >= MAX_ITEMS) break;
    const title = note.title.trim();
    if (!title) continue;
    const haystack = normalizeForSearch(title);
    if (!haystack.includes(needle)) continue;
    items.push({
      type: "insert",
      label: title,
      hint: "Nota",
      text: `(${title})`,
      reference: { kind: "note", noteId: note.id, title },
    });
  }

  // Title-search hits (chapters/articles by name, videos by name) — these
  // already name one exact document, so each is a ready-to-insert row rather
  // than a "keep typing" prefix, same as a fully-parsed "insert" row above.
  for (const chapter of search.chapters) {
    if (items.length >= MAX_ITEMS) break;
    items.push({
      type: "insert",
      label: `${chapter.chapterTitle} — ${chapter.publicationTitle}`,
      hint: "Publicação",
      text: `(${chapter.publicationTitle} — ${chapter.chapterTitle})`,
      reference: {
        kind: "publication",
        symbol: chapter.symbol || chapter.publicationTitle.toLowerCase(),
        chapter: null,
        documentId: chapter.documentId,
        publicationId: chapter.publicationId,
        isGlobal: chapter.source === "global",
      },
    });
  }

  for (const video of search.videos) {
    if (items.length >= MAX_ITEMS) break;
    items.push({
      type: "insert",
      label: video.title,
      hint: "Vídeo",
      text: `(${video.title})`,
      reference: { kind: "video", videoId: video.videoId, title: video.title },
    });
  }

  return items.slice(0, MAX_ITEMS);
}
