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

export interface PublicationOption {
  symbol: string;
  title: string;
}

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
function namePartOf(query: string): string {
  return query.replace(/[\d\s:.\-–—]+$/u, "").trim();
}

export function buildReferenceSuggestions(
  query: string,
  publications: PublicationOption[]
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
    } else {
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

  return items.slice(0, MAX_ITEMS);
}
