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

/**
 * Spellings that only really show up in JW.org's own video titles, where a
 * reference is abbreviated differently from both the NWT's table above and
 * from what a person types by hand — "Pro. 21:13", "Juí. 16:28", "Efé. 5:1",
 * "1 Crô. 29:14", "Tia. 4:8", "Luc. 12:15", "Apo. 16:16". Folded into the same
 * alias map as everything else rather than kept as a second table only the
 * title parser consults: none of them collide with an existing spelling, and a
 * person typing "Pro. 21:13" into a note deserves the same resolution.
 */
const TITLE_ALIASES: Record<number, string[]> = {
  6: ["josu"], 7: ["juí", "jui", "juiz"], 9: ["1sam"], 10: ["2sam"],
  13: ["1crô", "1cro"], 14: ["2crô", "2cro"], 16: ["nee"], 19: ["salm"],
  20: ["pro", "prov", "prové"], 21: ["ecl", "ecle"], 23: ["isa", "isaí"],
  24: ["jer", "jere"], 25: ["lam"], 26: ["eze"], 27: ["dan", "dani"],
  35: ["haba"], 38: ["zac"], 42: ["luc", "luca"], 44: ["ato"],
  49: ["efé", "efe", "efés"], 50: ["filip"], 54: ["1tim"], 55: ["2tim"],
  58: ["hebr"], 59: ["tia", "tiag"], 60: ["1ped"], 61: ["2ped"], 66: ["apo"],
};

/** Accent-sensitive lookups win; the accent-blind map is only a fallback (see the "jó" vs "jo" note on EXTRA_ALIASES). */
const exactAliases = new Map<string, number>();
const looseAliases = new Map<string, number>();
const ambiguousLoose = new Set<string>();

function registerAlias(alias: string | undefined, bookOrder: number) {
  if (!alias) return;
  const exact = normalize(alias);
  if (!exact) return;
  if (!exactAliases.has(exact)) exactAliases.set(exact, bookOrder);

  // Registered even when the alias carries no accent of its own (`loose ===
  // exact`), which it deliberately wasn't before: an accented spelling can
  // only resolve through this map, so "Efé." found nothing at all — its exact
  // form "efé" isn't listed, and stripping it to "efe" hit an empty loose map
  // because "efe" had been registered as an unaccented alias and returned
  // early here. Verified against real video titles: 36 of 487 references
  // (Pro./Juí./Efé./Crô.) failed to resolve for exactly this reason.
  //
  // Ambiguity detection still applies, and now actually fires for the "jó"
  // (18) vs "jo" (43) pair it was written for — both spellings keep resolving
  // through `exactAliases` above, which is consulted first.
  const loose = stripAccents(exact);
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
  for (const alias of TITLE_ALIASES[bookOrder] ?? []) registerAlias(alias, bookOrder);
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

// --- Free-text scanning (RAG retrieval), separate from the anchored parser above ---
//
// `bookOrderFromName` is safe to call on an already-isolated candidate (the
// Tiptap input rule only ever hands it text the user just typed inside
// parentheses), but several of its short aliases are ordinary Portuguese
// words -- "De" (Deuteronômio), "Da" (Daniel), "Os" (Oseias) -- so reusing it
// to scan whole sentences would false-positive on completely unrelated text
// ("fale um pouco da 5ª parte" -> "Daniel 5"). The scanner below only matches
// FULL book names, which don't have that problem (with one exception: see
// EXCLUDED_FROM_SCAN).

/** Book 4, "Números", is itself the ordinary word "numbers" -- excluded from the free-text scan since it would false-positive next to almost any unrelated number ("me passa os números 5 e 6"). */
const EXCLUDED_FROM_SCAN = new Set([4]);

/**
 * Full-name spellings a person actually says out loud that aren't the exact
 * string in BIBLE_BOOK_NAMES_PT — a speaker says "abram em Salmos 37", never
 * "em Salmo 37". Still full names, so they carry none of the short-alias
 * collision risk this scanner exists to avoid.
 */
const SCAN_NAME_VARIANTS: Record<number, string[]> = {
  19: ["Salmos"],
  // Nothing longer than three tokens — that's the widest window the scanner
  // below tries, so a four-word variant would silently never match.
  22: ["Cânticos", "Cantares"],
  28: ["Oséias"],
  44: ["Atos dos Apóstolos"],
};

const fullNameExact = new Map<string, number>();
const fullNameLoose = new Map<string, number>();
function registerFullName(name: string, bookOrder: number) {
  const exact = normalize(name);
  if (!fullNameExact.has(exact)) fullNameExact.set(exact, bookOrder);
  const loose = stripAccents(exact);
  if (!fullNameLoose.has(loose)) fullNameLoose.set(loose, bookOrder);
}
for (let bookOrder = 1; bookOrder <= 66; bookOrder += 1) {
  if (EXCLUDED_FROM_SCAN.has(bookOrder)) continue;
  registerFullName(BIBLE_BOOK_NAMES_PT[bookOrder], bookOrder);
  for (const variant of SCAN_NAME_VARIANTS[bookOrder] ?? []) registerFullName(variant, bookOrder);
}

function fullBookNameOrderFromName(raw: string): number | null {
  const exact = normalize(raw);
  if (!exact) return null;
  return fullNameExact.get(exact) ?? fullNameLoose.get(stripAccents(exact)) ?? null;
}

const SCAN_FILLER_WORDS = new Set(["capitulo", "cap", "versiculo", "v"]);

/** One word from `tokenizeForScan`, plus where it sits in the original string — needed to cut a snippet around a match (see `scanBibleReferences`), not just to identify it. */
interface PositionedToken {
  text: string;
  start: number;
  end: number;
}

function tokenizeForScan(text: string): PositionedToken[] {
  const tokens: PositionedToken[] = [];
  const wordPattern = /[\p{L}\p{N}]+/gu;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    tokens.push({ text: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

export interface InlineBibleReference {
  bookOrder: number;
  book: string;
  chapter: number;
  startVerse: number | null;
}

/** An `InlineBibleReference` plus the character range in the original text its "book chapter[:verse]" tokens span — the seed for cutting a snippet around it. */
interface ScannedBibleReference extends InlineBibleReference {
  charStart: number;
  charEnd: number;
}

/**
 * Every "book chapter[:verse]" mention in free-form text — a spoken video
 * transcript ("vamos abrir nossas Bíblias em Mateus capítulo 5… aqui em
 * Mateus 5:14, 15…"), or a chat question. Tries book-name windows of up to 3
 * tokens (to catch a numbered prefix like "1 Coríntios" or a multi-word name
 * like "Cântico de Salomão") at every position, longest first, so a real
 * match wins over any shorter coincidental one earlier in the same window.
 *
 * A match consumes the tokens it spans, so "1 Coríntios 9" is counted once
 * rather than also re-matching from its second token.
 *
 * Shared core behind `findAllBibleReferencesInText` (used by the RAG query
 * path, which only wants the reference itself) and
 * `findAllBibleReferenceSnippets` (used by the video-scripture indexer, which
 * also needs surrounding text to seek a player to). Kept private so the two
 * public shapes stay independent — TypeScript's excess-property check would
 * reject an object literal carrying `charStart`/`charEnd` being returned as
 * the narrower `InlineBibleReference[]`.
 */
function scanBibleReferences(text: string): ScannedBibleReference[] {
  const tokens = tokenizeForScan(text);
  const found: ScannedBibleReference[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    for (let windowLen = Math.min(3, tokens.length - i); windowLen >= 1; windowLen -= 1) {
      const candidate = tokens
        .slice(i, i + windowLen)
        .map((t) => t.text)
        .join(" ");
      const bookOrder = fullBookNameOrderFromName(candidate);
      if (bookOrder === null) continue;

      let j = i + windowLen;
      if (j < tokens.length && SCAN_FILLER_WORDS.has(stripAccents(tokens[j].text))) j += 1;
      if (j >= tokens.length || !/^\d{1,3}$/.test(tokens[j].text)) continue;

      const chapter = Number(tokens[j].text);
      if (chapter < 1 || chapter > BIBLE_BOOK_CHAPTER_COUNTS[bookOrder]) continue;

      const k = j + 1;
      let startVerse: number | null = null;
      let consumedThrough = j;
      if (k < tokens.length && /^\d{1,3}$/.test(tokens[k].text)) {
        startVerse = Number(tokens[k].text);
        consumedThrough = k;
      } else if (
        k < tokens.length &&
        SCAN_FILLER_WORDS.has(stripAccents(tokens[k].text)) &&
        k + 1 < tokens.length &&
        /^\d{1,3}$/.test(tokens[k + 1].text)
      ) {
        startVerse = Number(tokens[k + 1].text);
        consumedThrough = k + 1;
      }

      found.push({
        bookOrder,
        book: BIBLE_BOOK_NAMES_PT[bookOrder],
        chapter,
        startVerse,
        charStart: tokens[i].start,
        charEnd: tokens[consumedThrough].end,
      });
      i = consumedThrough;
      break;
    }
  }

  return found;
}

export function findAllBibleReferencesInText(text: string): InlineBibleReference[] {
  return scanBibleReferences(text).map(({ bookOrder, book, chapter, startVerse }) => ({
    bookOrder,
    book,
    chapter,
    startVerse,
  }));
}

/**
 * The first such mention, or `null`. Kept as its own export because the RAG
 * retrieval path (lib/vector/rag-query.ts) only ever wants the one scripture a
 * question is about, and reads much clearer than indexing `[0]` at the call
 * site.
 */
export function findBibleReferenceInText(text: string): InlineBibleReference | null {
  return findAllBibleReferencesInText(text)[0] ?? null;
}

/** How many characters of context to keep on each side of a mention — enough words for `InlineVideoCard`'s snippet matching (it only needs the first few) to land on the right VTT caption without dragging in an unrelated sentence. */
const SNIPPET_RADIUS = 90;

export interface BibleReferenceSnippet extends InlineBibleReference {
  /** Collapsed-whitespace excerpt of the source text centered on this mention — not HTML, safe to hand straight to `InlineVideoCard`'s programmatic (not rendered) snippet matching. */
  snippet: string;
}

/**
 * Same scan as `findAllBibleReferencesInText`, but each hit carries the
 * surrounding text too — used by `lib/bible/video-scripture-refs.ts` to seek a
 * video player to the moment a chapter is actually cited, the same way a
 * search hit's `ts_headline` excerpt does (see `InlineVideoCard`'s `snippet`
 * prop). Kept as a separate export rather than added to
 * `findAllBibleReferencesInText` itself so that function's return type stays
 * exactly what its other caller (`lib/vector/rag-query.ts`) already expects.
 */
export function findAllBibleReferenceSnippets(text: string): BibleReferenceSnippet[] {
  return scanBibleReferences(text).map((ref) => {
    const start = Math.max(0, ref.charStart - SNIPPET_RADIUS);
    const end = Math.min(text.length, ref.charEnd + SNIPPET_RADIUS);
    return {
      bookOrder: ref.bookOrder,
      book: ref.book,
      chapter: ref.chapter,
      startVerse: ref.startVerse,
      snippet: text.slice(start, end).replace(/\s+/g, " ").trim(),
    };
  });
}

// --- Video-title reference extraction ---

/**
 * The "(1 Cor. 11:24)" / "— Jer. 29:11" tail a JW.org video title carries.
 * Abbreviations are safe to resolve here, unlike in the free-text scan above:
 * an explicit `chapter:verse` colon has to follow, which ordinary prose in a
 * title essentially never produces. The leading `([1-3]\s*)?` keeps a numbered
 * book's ordinal ("1 Cor.", "2 Tim.") attached to the name that follows it.
 */
const TITLE_REFERENCE_PATTERN =
  /(?:([1-3])\s*)?(\p{L}[\p{L}]{1,14})\.?\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–—,]\s*(\d{1,3}))?/gu;

export interface TitleBibleReference {
  bookOrder: number;
  book: string;
  chapter: number;
  startVerse: number | null;
  endVerse: number | null;
}

/**
 * Every Bible reference cited in a video title. Two passes, deliberately:
 * the abbreviation-tolerant one above for the overwhelmingly common
 * parenthesised "(Tia. 4:8)" form, plus the full-name-only free-text scan for
 * the chapter-level titles that have no verse at all ("Profecias da Bíblia —
 * Daniel, capítulo 11"), where an abbreviation with no colon after it would be
 * far too easy to confuse with an ordinary word.
 *
 * Measured against all 2.460 videos in the catalog: 486 of the 487 titles
 * carrying an `N:N` reference resolve to a real book and chapter.
 */
export function extractBibleReferencesFromTitle(title: string): TitleBibleReference[] {
  const found: TitleBibleReference[] = [];
  const seen = new Set<string>();

  function push(ref: TitleBibleReference) {
    const key = `${ref.bookOrder}:${ref.chapter}:${ref.startVerse ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(ref);
  }

  for (const match of title.matchAll(TITLE_REFERENCE_PATTERN)) {
    const bookOrder = bookOrderFromName(`${match[1] ?? ""}${match[2]}`);
    if (bookOrder === null) continue;

    const chapter = Number(match[3]);
    if (chapter < 1 || chapter > BIBLE_BOOK_CHAPTER_COUNTS[bookOrder]) continue;

    const startVerse = Number(match[4]);
    const endVerse = match[5] ? Number(match[5]) : null;
    push({
      bookOrder,
      book: BIBLE_BOOK_NAMES_PT[bookOrder],
      chapter,
      startVerse,
      // "(Mat. 11:29, 30)" lists two verses rather than a range, but either
      // way the pair brackets what the talk is about — storing it as a range
      // is both true and what the reader wants to highlight.
      endVerse: endVerse !== null && endVerse > startVerse ? endVerse : null,
    });
  }

  for (const ref of findAllBibleReferencesInText(title)) {
    push({ ...ref, endVerse: null });
  }

  return found;
}
