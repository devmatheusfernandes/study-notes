"use server";

import { createClient } from "@/lib/supabase/server";
import { decryptText } from "@/lib/encryption";
import { syncNoteScriptureRefs } from "@/lib/bible/note-scripture-sync";

/** Notes parsed per backfill call — each is a couple of small queries, so this stays well inside a Server Action's budget. */
const BACKFILL_BATCH_SIZE = 40;

/** One place a personal note cites the chapter being read. */
export interface NoteScriptureMention {
  noteId: string;
  bookOrder: number;
  chapter: number;
  title: string;
  verse: number | null;
  endVerse: number | null;
  snippet: string;
  updatedAt: number;
}

/**
 * Active (not archived, not trashed) text notes that cite a chapter. RLS
 * already scopes the rows to the caller; the `notes!inner` join is what lets
 * the status filter drop archived and trashed notes without a second query.
 */
export async function getNoteScriptureMentions(
  bookOrder: number,
  chapter: number
): Promise<{ mentions?: NoteScriptureMention[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("note_scripture_refs")
    .select("note_id, verse, end_verse, snippet, notes!inner(title, status, type, updated_at)")
    .eq("book_order", bookOrder)
    .eq("chapter", chapter)
    .eq("notes.status", "active")
    .eq("notes.type", "nota");
  if (error) return { error: "Não foi possível carregar as notas." };

  type Row = {
    note_id: string;
    verse: number | null;
    end_verse: number | null;
    snippet: string | null;
    notes: { title: string; updated_at: string } | { title: string; updated_at: string }[];
  };

  const mentions = ((data ?? []) as unknown as Row[]).map((row) => {
    const note = Array.isArray(row.notes) ? row.notes[0] : row.notes;
    return {
      noteId: row.note_id,
      bookOrder,
      chapter,
      title: decryptText(note.title) ?? "",
      verse: row.verse,
      endVerse: row.end_verse,
      snippet: decryptText(row.snippet) ?? "",
      updatedAt: new Date(note.updated_at).getTime(),
    };
  });

  // Chapter-level mentions (no verse) first, then by verse, newest note first.
  mentions.sort((a, b) => (a.verse ?? 0) - (b.verse ?? 0) || b.updatedAt - a.updatedAt);
  return { mentions };
}

/**
 * Parses the next batch of notes saved before `note_scripture_refs` existed.
 * The reader calls this on mount and loops until `remaining` is 0, then
 * refetches — so the very first visit to the Bible after this ships fills the
 * tab in by itself, with nothing for the user to run.
 */
export async function backfillNoteScriptureRefs(): Promise<{ remaining: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { remaining: 0 };

  const { data: notes } = await supabase
    .from("notes")
    .select("id, body")
    .eq("type", "nota")
    .is("scriptures_indexed_at", null)
    .limit(BACKFILL_BATCH_SIZE);

  for (const note of notes ?? []) {
    await syncNoteScriptureRefs(supabase, user.id, note.id, decryptText(note.body) ?? "");
  }

  const { count } = await supabase
    .from("notes")
    .select("*", { count: "exact", head: true })
    .eq("type", "nota")
    .is("scriptures_indexed_at", null);

  // A batch that stamped nothing (every sync failed) would loop forever; the
  // caller also stops when `remaining` doesn't go down.
  return { remaining: count ?? 0 };
}
