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
  refBookOrder: number;
  refChapter: number;
  refStartVerse: number;
  refEndVerse: number | null;
}

/** Cross references for one verse — see data/cross_references.sqlite and scripts/seed-cross-references.mjs for the source/decoding. Book names for display are resolved by the caller from its already-loaded listBibleBooks() list. */
export async function getVerseCrossReferences(
  bookOrder: number,
  chapter: number,
  verse: number
): Promise<{ refs?: CrossReference[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_cross_references")
    .select("rank, ref_book_order, ref_chapter, ref_start_verse, ref_end_verse")
    .eq("book_order", bookOrder)
    .eq("chapter", chapter)
    .eq("verse", verse)
    .order("rank", { ascending: true });

  if (error) return { error: "Não foi possível carregar as referências." };

  return {
    refs: (data ?? []).map((row) => ({
      rank: row.rank,
      refBookOrder: row.ref_book_order,
      refChapter: row.ref_chapter,
      refStartVerse: row.ref_start_verse,
      refEndVerse: row.ref_end_verse,
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
