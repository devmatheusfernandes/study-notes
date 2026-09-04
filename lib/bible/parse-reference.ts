/**
 * Free-text Bible reference parsing — turns what someone actually types in a
 * note ("mt 7:12", "1 co 13:4-8", "Salmo 23") into the `book_order` /
 * chapter / verse triple every query in app/(app)/bible-actions.ts already
 * speaks.
 *
 * Deliberately offline (a static table, no round trip): this runs inside a
 * Tiptap input rule on every closing parenthesis the user types, so it has to
 * answer synchronously — and the canon doesn't change.
 */

import { BIBLE_BOOK_ABBREVIATIONS_PT } from "./book-abbreviations";

/** Full Portuguese book names, exactly as seeded into `bible_verses.book` (see scripts/seed-bible.mjs) — so a parsed reference can be labeled without a query. */
export const BIBLE_BOOK_NAMES_PT: Record<number, string> = {
  1: "Gênesis", 2: "Êxodo", 3: "Levítico", 4: "Números", 5: "Deuteronômio",
  6: "Josué", 7: "Juízes", 8: "Rute", 9: "1 Samuel", 10: "2 Samuel",
  11: "1 Reis", 12: "2 Reis", 13: "1 Crônicas", 14: "2 Crônicas", 15: "Esdras",
  16: "Neemias", 17: "Ester", 18: "Jó", 19: "Salmo", 20: "Provérbios",
  21: "Eclesiastes", 22: "Cântico de Salomão", 23: "Isaías", 24: "Jeremias",
  25: "Lamentações", 26: "Ezequiel", 27: "Daniel", 28: "Oseias", 29: "Joel",
  30: "Amós", 31: "Obadias", 32: "Jonas", 33: "Miqueias", 34: "Naum",
  35: "Habacuque", 36: "Sofonias", 37: "Ageu", 38: "Zacarias", 39: "Malaquias",
  40: "Mateus", 41: "Marcos", 42: "Lucas", 43: "João", 44: "Atos",
  45: "Romanos", 46: "1 Coríntios", 47: "2 Coríntios", 48: "Gálatas",
  49: "Efésios", 50: "Filipenses", 51: "Colossenses", 52: "1 Tessalonicenses",
  53: "2 Tessalonicenses", 54: "1 Timóteo", 55: "2 Timóteo", 56: "Tito",
  57: "Filêmon", 58: "Hebreus", 59: "Tiago", 60: "1 Pedro", 61: "2 Pedro",
  62: "1 João", 63: "2 João", 64: "3 João", 65: "Judas", 66: "Apocalipse",
};

/**
 * Chapter counts, used purely as a *rejection* filter: without it, ordinary
 * parenthetical prose like "(Jó 900)" or a stray "(am 40)" would be marked up
 * as a reference and only fail once clicked. Cheaper, and far less
 * surprising, than letting the server answer "não encontrado".
 */
export const BIBLE_BOOK_CHAPTER_COUNTS: Record<number, number> = {
  1: 50, 2: 40, 3: 27, 4: 36, 5: 34, 6: 24, 7: 21, 8: 4, 9: 31, 10: 24,
  11: 22, 12: 25, 13: 29, 14: 36, 15: 10, 16: 13, 17: 10, 18: 42, 19: 150,
  20: 31, 21: 12, 22: 8, 23: 66, 24: 52, 25: 5, 26: 48, 27: 12, 28: 14,
  29: 3, 30: 9, 31: 1, 32: 4, 33: 7, 34: 3, 35: 3, 36: 3, 37: 2, 38: 14,
  39: 4, 40: 28, 41: 16, 42: 24, 43: 21, 44: 28, 45: 16, 46: 16, 47: 13,
  48: 6, 49: 6, 50: 4, 51: 4, 52: 5, 53: 3, 54: 6, 55: 4, 56: 3, 57: 1,
  58: 13, 59: 5, 60: 5, 61: 3, 62: 5, 63: 1, 64: 1, 65: 1, 66: 22,
};

/**
 * Extra spellings people actually type, beyond the full name and the NWT's
 * own abbreviation. Accents are significant here — "jó" is Jó (18) while
 * "jo" is João (43), the single most likely mix-up in the whole table.
 */
const EXTRA_ALIASES: Record<number, string[]> = {
  1: ["gn", "gen"], 2: ["ex", "exo"], 3: ["lv", "lev"], 4: ["nm", "num"],
  5: ["dt", "deut"], 6: ["js"], 7: ["jz"], 8: ["rt"], 9: ["1sm", "1s"],
  10: ["2sm", "2s"], 11: ["1rs", "1r"], 12: ["2rs", "2r"], 13: ["1cr"],
  14: ["2cr"], 15: ["ed"], 16: ["ne"], 17: ["et"], 18: ["job"],
  19: ["sl", "sal", "salmos"], 20: ["pv"], 21: ["ec"],
  22: ["ct", "cantico", "canticos", "cantares"], 23: ["is"], 24: ["jr"],
  25: ["lm"], 26: ["ez"], 27: ["dn"], 28: ["os"], 29: ["jl"], 30: ["am"],
  31: ["ob"], 32: ["jn"], 33: ["mq"], 34: ["na"], 35: ["hc"], 36: ["sf"],
  37: ["ag"], 38: ["zc"], 39: ["ml"],
  40: ["mt", "mat", "math"], 41: ["mc", "mar"], 42: ["lc"],
  43: ["jo", "joao"], 44: ["at"], 45: ["rm", "rom"], 46: ["1co", "1cor"],
  47: ["2co", "2cor"], 48: ["gl"], 49: ["ef"], 50: ["fp", "fil"], 51: ["cl"],
  52: ["1ts", "1tes"], 53: ["2ts", "2tes"], 54: ["1tm"], 55: ["2tm"],
  56: ["tt"], 57: ["fm"], 58: ["hb", "heb"], 59: ["tg"], 60: ["1pe", "1pd"],
  61: ["2pe", "2pd"], 62: ["1jo"], 63: ["2jo"], 64: ["3jo"], 65: ["jd"],
  66: ["ap", "apoc"],
};

/** Lowercase, collapse whitespace, drop the dots people put after an abbreviation ("1 Co." → "1co"). */
function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[.\s]+/g, "").trim();
}

function stripAccents(raw: string): string {
  return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Accent-sensitive lookups win; the accent-blind map is only a fallback (see the "jó" vs "jo" note on EXTRA_ALIASES). */
const exactAliases = new Map<string, number>();
const looseAliases = new Map<string, number>();
const ambiguousLoose = new Set<string>();

function registerAlias(alias: string | undefined, bookOrder: number) {
  if (!alias) return;
  const exact = normalize(alias);
  if (!exact) return;
  if (!exactAliases.has(exact)) exactAliases.set(exact, bookOrder);

  const loose = stripAccents(exact);
  if (loose === exact) return;
  const existing = looseAliases.get(loose);
  if (existing !== undefined && existing !== bookOrder) {
    ambiguousLoose.add(loose);
    return;
  }
  looseAliases.set(loose, bookOrder);
}

for (let bookOrder = 1; bookOrder <= 66; bookOrder += 1) {
  registerAlias(BIBLE_BOOK_NAMES_PT[bookOrder], bookOrder);
  registerAlias(BIBLE_BOOK_ABBREVIATIONS_PT[bookOrder], bookOrder);
  for (const alias of EXTRA_ALIASES[bookOrder] ?? []) registerAlias(alias, bookOrder);
}

// A spelling that differs from another book only by accents ("Jo" vs "Jó")
// must not resolve through the accent-blind pass to whichever happened to be
// registered first — better to require the accent than to open the wrong book.
for (const loose of ambiguousLoose) looseAliases.delete(loose);

/** `null` when the token isn't a Bible book at all — the common case for ordinary parenthetical prose. */
export function bookOrderFromName(raw: string): number | null {
  const exact = normalize(raw);
  if (!exact) return null;
  return exactAliases.get(exact) ?? looseAliases.get(stripAccents(exact)) ?? null;
}

export interface ParsedBibleReference {
  kind: "bible";
  bookOrder: number;
  /** Full Portuguese name, for the panel header — not whatever the user typed. */
  book: string;
  chapter: number;
  /** `null` for a whole-chapter reference like "Salmo 23". */
  startVerse: number | null;
  /** `null` unless the user wrote a range ("mt 7:12-14"). */
  endVerse: number | null;
}

//  "1 Coríntios 13:4-8" → ["1 Coríntios", "13", "4", "8"]
//  The book part is lazy-but-bounded so a leading ordinal ("1 Co") survives
//  while the chapter/verse tail stays anchored to the end of the string.
const REFERENCE_PATTERN =
  /^([1-3]?\s*\p{L}[\p{L}.\s]{0,24}?)\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?$/u;

/**
 * Parses one already-extracted reference body (no surrounding parentheses).
 * Returns `null` for anything that isn't confidently a Bible reference — the
 * caller then leaves the text alone rather than marking it up.
 */
export function parseBibleReference(raw: string): ParsedBibleReference | null {
  const match = REFERENCE_PATTERN.exec(raw.trim());
  if (!match) return null;

  const bookOrder = bookOrderFromName(match[1]);
  if (bookOrder === null) return null;

  const chapter = Number(match[2]);
  if (!Number.isFinite(chapter) || chapter < 1 || chapter > BIBLE_BOOK_CHAPTER_COUNTS[bookOrder]) {
    return null;
  }

  const startVerse = match[3] ? Number(match[3]) : null;
  const endVerse = match[4] ? Number(match[4]) : null;
  if (startVerse !== null && startVerse < 1) return null;
  if (endVerse !== null && (startVerse === null || endVerse <= startVerse)) return null;

  return {
    kind: "bible",
    bookOrder,
    book: BIBLE_BOOK_NAMES_PT[bookOrder],
    chapter,
    startVerse,
    endVerse,
  };
}

/** Canonical display form — "Mateus 7:12-14", "Salmo 23". */
export function formatBibleReference(ref: ParsedBibleReference): string {
  if (ref.startVerse === null) return `${ref.book} ${ref.chapter}`;
  if (ref.endVerse === null) return `${ref.book} ${ref.chapter}:${ref.startVerse}`;
  return `${ref.book} ${ref.chapter}:${ref.startVerse}-${ref.endVerse}`;
}
