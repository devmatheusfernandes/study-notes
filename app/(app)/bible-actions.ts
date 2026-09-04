"use server";

import { createClient } from "@/lib/supabase/server";

export interface BibleVerseRow {
  id: number;
  book: string;
  chapter: number;
  verse: number | null;
  text: string | null;
  isSuperscription: boolean;
}

const MAX_RANGE = 200; // generous upper bound — a citation is never a whole book

/** Resolves a jwpub bible citation's verse range against public.bible_verses. */
export async function getBibleVerses(
  firstVerseId: number,
  lastVerseId: number
): Promise<{ verses?: BibleVerseRow[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  if (
    !Number.isFinite(firstVerseId) ||
    !Number.isFinite(lastVerseId) ||
    firstVerseId > lastVerseId ||
    lastVerseId - firstVerseId > MAX_RANGE
  ) {
    return { error: "Referência bíblica inválida." };
  }

  const { data, error } = await supabase
    .from("bible_verses")
    .select("id, book, chapter, verse, text, is_superscription")
    .gte("id", firstVerseId)
    .lte("id", lastVerseId)
    .order("id", { ascending: true });

  if (error) return { error: "Não foi possível carregar o texto bíblico." };
  if (!data || data.length === 0) return { error: "Referência não encontrada." };

  return {
    verses: data.map((row) => ({
      id: row.id,
      book: row.book,
      chapter: row.chapter,
      verse: row.verse,
      text: row.text,
      isSuperscription: row.is_superscription,
    })),
  };
}

/**
 * Resolves a `.jwlibrary` Bible note's raw reference — `bookNumber` is the
 * same 1-66 canonical order as `book_order` (see data/NWT_structure.md), so
 * this needs no id lookup first, unlike getBibleVerses (which resolves a
 * jwpub BibleCitation's already-known verse-id range).
 */
export async function getBibleVerseByReference(
  bookNumber: number,
  chapter: number,
  verse: number | null
): Promise<{ verse?: BibleVerseRow; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  let query = supabase
    .from("bible_verses")
    .select("id, book, chapter, verse, text, is_superscription")
    .eq("book_order", bookNumber)
    .eq("chapter", chapter);

  query = verse === null ? query.eq("is_superscription", true) : query.eq("verse", verse);

  const { data, error } = await query.maybeSingle();

  if (error) return { error: "Não foi possível carregar o texto bíblico." };
  if (!data) return { error: "Referência não encontrada." };

  return {
    verse: {
      id: data.id,
      book: data.book,
      chapter: data.chapter,
      verse: data.verse,
      text: data.text,
      isSuperscription: data.is_superscription,
    },
  };
}

/** Every verse (including any superscription row) of one chapter — the core "load a whole chapter" query for components/content/bible-reader.tsx, which neither getBibleVerses (id-range) nor getBibleVerseByReference (single verse) serve. */
export async function getBibleChapterVerses(
  bookOrder: number,
  chapter: number
): Promise<{ verses?: BibleVerseRow[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_verses")
    .select("id, book, chapter, verse, text, is_superscription")
    .eq("book_order", bookOrder)
    .eq("chapter", chapter)
    .order("id", { ascending: true });

  if (error) return { error: "Não foi possível carregar o capítulo." };
  if (!data || data.length === 0) return { error: "Capítulo não encontrado." };

  return {
    verses: data.map((row) => ({
      id: row.id,
      book: row.book,
      chapter: row.chapter,
      verse: row.verse,
      text: row.text,
      isSuperscription: row.is_superscription,
    })),
  };
}

export interface CrossReference {
  rank: number;
  /** Marginal letter (a, b, c…) this reference hangs off, so several refs can be grouped under one letter like in JW Library. Only set for `source = "nwt"` — see migration 0020. */
  marker: number | null;
  refBookOrder: number;
  refChapter: number;
  /** `null` when the target is a Psalm superscription, which has no verse number (31 of these — e.g. Genesis 39 → the superscription of Psalm 51). */
  refStartVerse: number | null;
  refEndVerse: number | null;
}

/**
 * The two cross-reference datasets that live in `bible_cross_references`.
 *
 * `nwt` are the official NWT marginal references (60.884, what JW Library
 * itself shows); `extended` is the much broader third-party set seeded from
 * data/cross_references.sqlite (343.609). Only 16.022 pairs overlap, so
 * neither is a newer version of the other — see migration 0020.
 */
export type CrossReferenceSource = "nwt" | "extended";

/** Cross references for one verse. Book names for display are resolved by the caller from its already-loaded listBibleBooks() list. */
export async function getVerseCrossReferences(
  bookOrder: number,
  chapter: number,
  verse: number,
  source: CrossReferenceSource = "nwt"
): Promise<{ refs?: CrossReference[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_cross_references")
    .select("rank, marker, ref_book_order, ref_chapter, ref_start_verse, ref_end_verse")
    .eq("book_order", bookOrder)
    .eq("chapter", chapter)
    .eq("verse", verse)
    .eq("source", source)
    .order("rank", { ascending: true });

  if (error) return { error: "Não foi possível carregar as referências." };

  return {
    refs: (data ?? []).map((row) => ({
      rank: row.rank,
      marker: row.marker,
      refBookOrder: row.ref_book_order,
      refChapter: row.ref_chapter,
      refStartVerse: row.ref_start_verse,
      refEndVerse: row.ref_end_verse,
    })),
  };
}

/**
 * Cap for the whole-chapter reference view (the study panel before any verse
 * is tapped). `nwt` never reaches it — its worst chapter is 298 references.
 * `extended` does: Salmo 119 alone has 2.083, and 120 chapters carry more
 * than 500, so an uncapped select would silently hit PostgREST's own 1000-row
 * ceiling and look like missing data. Truncating explicitly, and saying so in
 * the UI, is the honest version of the same limit.
 */
const CHAPTER_REFS_LIMIT = 400;

/** Every cross reference in a chapter, for the study panel's "nothing selected yet" state. `truncated` tells the caller the list was cut — see CHAPTER_REFS_LIMIT. */
export async function getChapterCrossReferences(
  bookOrder: number,
  chapter: number,
  source: CrossReferenceSource = "nwt"
): Promise<{ refs?: (CrossReference & { verse: number | null })[]; truncated?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_cross_references")
    .select("verse, rank, marker, ref_book_order, ref_chapter, ref_start_verse, ref_end_verse")
    .eq("book_order", bookOrder)
    .eq("chapter", chapter)
    .eq("source", source)
    .order("verse", { ascending: true, nullsFirst: true })
    .order("rank", { ascending: true })
    .limit(CHAPTER_REFS_LIMIT);

  if (error) return { error: "Não foi possível carregar as referências." };

  return {
    truncated: (data ?? []).length === CHAPTER_REFS_LIMIT,
    refs: (data ?? []).map((row) => ({
      verse: row.verse,
      rank: row.rank,
      marker: row.marker,
      refBookOrder: row.ref_book_order,
      refChapter: row.ref_chapter,
      refStartVerse: row.ref_start_verse,
      refEndVerse: row.ref_end_verse,
    })),
  };
}

export interface BibleFootnote {
  id: number;
  /**
   * `bible_verses.id`, not a verse *number* — the footnotes table has no
   * verse column and there's no FK to embed through (see migration 0020).
   * The reader maps this to a number with the chapter's verses, which it has
   * already loaded anyway, instead of paying for a second query here.
   */
  verseId: number;
  /** Sequential per BOOK (matches the source's `data-fnid`), not per verse. */
  index: number;
  contentHtml: string;
}

export interface BibleStudyNote {
  id: number;
  verse: number | null;
  labelHtml: string | null;
  contentHtml: string;
}

/**
 * Every footnote and study note of one chapter, in a single round trip.
 *
 * Deliberately one action rather than two: the reader already fires three
 * requests per chapter (verses, highlights, and references on demand), and
 * splitting these would make it five. Worst case in the whole Bible is 92
 * footnotes (Salmo 119) and 45 study notes (Mateus 27) — nowhere near
 * PostgREST's 1000-row cap, which has bitten this file before (see
 * listBibleBooks).
 *
 * Study notes only exist for Mateus–Filêmon (minus Tito) — everything else
 * legitimately comes back empty, which is a normal state, not an error.
 */
export async function getChapterStudyContent(
  bookOrder: number,
  chapter: number
): Promise<{ footnotes?: BibleFootnote[]; studyNotes?: BibleStudyNote[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const [footnotesResult, studyNotesResult] = await Promise.all([
    supabase
      .from("bible_footnotes")
      .select("id, verse_id, footnote_index, content_html")
      .eq("book_order", bookOrder)
      .eq("chapter", chapter)
      .order("footnote_index", { ascending: true }),
    supabase
      .from("bible_study_notes")
      .select("id, verse, label_html, content_html")
      .eq("book_order", bookOrder)
      .eq("chapter", chapter)
      .order("verse", { ascending: true }),
  ]);

  if (footnotesResult.error || studyNotesResult.error) {
    return { error: "Não foi possível carregar o conteúdo de estudo." };
  }

  return {
    footnotes: (footnotesResult.data ?? []).map((row) => ({
      id: row.id,
      verseId: row.verse_id,
      index: row.footnote_index,
      contentHtml: row.content_html,
    })),
    studyNotes: (studyNotesResult.data ?? []).map((row) => ({
      id: row.id,
      verse: row.verse,
      labelHtml: row.label_html,
      contentHtml: row.content_html,
    })),
  };
}

export interface BibleOutlineNode {
  id: number;
  parentId: number | null;
  level: number;
  beginChapter: number | null;
  beginVerse: number | null;
  endChapter: number | null;
  endVerse: number | null;
  title: string;
}

/**
 * A book's thematic outline, flat — the caller builds the tree from
 * `parentId` (doing it here would just mean serializing a nested structure
 * the client would have to walk anyway).
 *
 * Level 1 rows are bare chapter-number markers ("1", "2", …), not section
 * titles; the chapter grid skips them. Largest book is Salmo at 706 rows,
 * still under PostgREST's 1000-row cap, but that is the number to watch if
 * this ever gains a source with finer granularity.
 */
export async function getBookOutline(
  bookOrder: number
): Promise<{ nodes?: BibleOutlineNode[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_outline")
    .select("id, parent_id, level, begin_chapter, begin_verse, end_chapter, end_verse, title")
    .eq("book_order", bookOrder)
    .order("id", { ascending: true });

  if (error) return { error: "Não foi possível carregar o esboço." };

  return {
    nodes: (data ?? []).map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      level: row.level,
      beginChapter: row.begin_chapter,
      beginVerse: row.begin_verse,
      endChapter: row.end_chapter,
      endVerse: row.end_verse,
      title: row.title,
    })),
  };
}

/** One verse or a small verse range (a cross reference's target) by book/chapter — for the accordion preview in bible-references-panel.tsx, so expanding a reference doesn't need the whole chapter. */
export async function getBibleVerseRange(
  bookOrder: number,
  chapter: number,
  startVerse: number,
  endVerse: number | null
): Promise<{ verses?: BibleVerseRow[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  let query = supabase
    .from("bible_verses")
    .select("id, book, chapter, verse, text, is_superscription")
    .eq("book_order", bookOrder)
    .eq("chapter", chapter);
  query = endVerse ? query.gte("verse", startVerse).lte("verse", endVerse) : query.eq("verse", startVerse);

  const { data, error } = await query.order("id", { ascending: true });

  if (error) return { error: "Não foi possível carregar o versículo." };
  if (!data || data.length === 0) return { error: "Versículo não encontrado." };

  return {
    verses: data.map((row) => ({
      id: row.id,
      book: row.book,
      chapter: row.chapter,
      verse: row.verse,
      text: row.text,
      isSuperscription: row.is_superscription,
    })),
  };
}

export interface BibleBook {
  book: string;
  bookOrder: number;
}

/**
 * For the Bible reference picker (components/content/bible-reference-picker.tsx)
 * and the /bible book grid — no browsable book/chapter/verse list existed
 * anywhere before.
 *
 * Filters to `chapter = 1 and verse = 1` (one row per book, 66 total)
 * instead of selecting every verse and deduping client-side — PostgREST caps
 * an unbounded select at 1000 rows, and Genesis alone has 1,533 verses, so
 * the old dedupe-after-fetch approach silently returned Genesis only
 * (confirmed empirically: the /bible book grid showed just "GE").
 */
export async function listBibleBooks(): Promise<{ books?: BibleBook[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_verses")
    .select("book, book_order")
    .eq("chapter", 1)
    .eq("verse", 1)
    .order("book_order", { ascending: true });

  if (error) return { error: "Não foi possível carregar os livros da Bíblia." };

  const seen = new Set<number>();
  const books: BibleBook[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.book_order)) continue;
    seen.add(row.book_order);
    books.push({ book: row.book, bookOrder: row.book_order });
  }
  return { books };
}

/** Highest chapter number in a book — enough to render a "Capítulo 1..N" select. */
export async function getBibleChapterCount(bookOrder: number): Promise<{ count?: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_verses")
    .select("chapter")
    .eq("book_order", bookOrder)
    .order("chapter", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return { error: "Não foi possível carregar os capítulos." };
  return { count: data.chapter };
}

/** Highest verse number in a chapter (superscriptions excluded — they aren't a pickable verse). */
export async function getBibleVerseCount(
  bookOrder: number,
  chapter: number
): Promise<{ count?: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_verses")
    .select("verse")
    .eq("book_order", bookOrder)
    .eq("chapter", chapter)
    .eq("is_superscription", false)
    .order("verse", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return { error: "Não foi possível carregar os versículos." };
  return { count: data.verse ?? 1 };
}

export type BibleAppendixLetter = "A" | "B" | "C";

export interface BibleAppendixHeader {
  mepsDocumentId: number;
  letter: BibleAppendixLetter;
  title: string;
}

/**
 * The 3 section headers ("Apêndice A/B/C") — the entry point for browsing,
 * since each header's own contentHtml is already the source's index of that
 * section's articles (a plain `<ol>` of links). Rendering the header IS the
 * table of contents; no separate "list of titles" query is needed.
 */
export async function listBibleAppendixHeaders(): Promise<{ headers?: BibleAppendixHeader[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_appendices")
    .select("meps_document_id, appendix_letter, title")
    .eq("section", "header")
    .order("appendix_letter", { ascending: true });

  if (error) return { error: "Não foi possível carregar os apêndices." };

  return {
    headers: (data ?? []).map((row) => ({
      mepsDocumentId: row.meps_document_id,
      letter: row.appendix_letter as BibleAppendixLetter,
      title: row.title,
    })),
  };
}

export interface BibleAppendix {
  mepsDocumentId: number;
  letter: BibleAppendixLetter;
  section: "header" | "article";
  title: string;
  contentHtml: string;
}

/**
 * One appendix (header or article) by its `meps_document_id` — the id
 * carried in a `data-bible-appendix-ref` link (see
 * scripts/bible-study-html.mjs's rewrite of `jwpub://p/T:{id}/`), not the
 * table's own `id`/DocumentId. Resolves both the 422 links already inside
 * study notes and the ~627 appendix-to-appendix links inside the appendices
 * themselves (e.g. every article's header links back to its section index).
 */
export async function getBibleAppendix(
  mepsDocumentId: number
): Promise<{ appendix?: BibleAppendix; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_appendices")
    .select("meps_document_id, appendix_letter, section, title, content_html")
    .eq("meps_document_id", mepsDocumentId)
    .maybeSingle();

  if (error) return { error: "Não foi possível carregar o apêndice." };
  if (!data) return { error: "Apêndice não encontrado." };

  return {
    appendix: {
      mepsDocumentId: data.meps_document_id,
      letter: data.appendix_letter as BibleAppendixLetter,
      section: data.section as "header" | "article",
      title: data.title,
      contentHtml: data.content_html,
    },
  };
}
