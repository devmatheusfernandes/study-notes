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
