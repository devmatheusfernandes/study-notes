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

export interface BibleBook {
  book: string;
  bookOrder: number;
}

/** For the Bible reference picker (components/content/bible-reference-picker.tsx) — no browsable book/chapter/verse list existed anywhere before. */
export async function listBibleBooks(): Promise<{ books?: BibleBook[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_verses")
    .select("book, book_order")
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
