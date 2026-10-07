import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptText } from "@/lib/encryption";
import { findBibleReferencesInNote } from "./parse-reference";

/**
 * A ceiling on how many references one note can contribute — insurance against
 * a pasted-in study outline, not a limit a normal note comes near.
 */
const MAX_REFS_PER_NOTE = 100;

const BLOCK_END = /<\/(?:p|li|h[1-6]|div|blockquote|pre|tr)>|<br\s*\/?>/gi;

/**
 * Tiptap HTML → plain text. Block boundaries become newlines BEFORE the tags
 * are dropped, otherwise two adjacent paragraphs ("…Mateus" / "5…") fuse into
 * one false reference. Regex-based on purpose: this runs on the server, where
 * there is no DOMParser (same constraint as lib/note-images.ts).
 */
export function noteHtmlToPlainText(html: string): string {
  return html
    .replace(BLOCK_END, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Re-parses a note's scripture citations into `note_scripture_refs` (replacing
 * whatever was there) and stamps `scriptures_indexed_at`. The caller has
 * already verified the session and passes the per-request client, so RLS keeps
 * this scoped to the owner. Best-effort: a failure here must never fail the
 * note save that triggered it — the backfill picks the note up again because
 * the stamp is only written once the rows are.
 */
export async function syncNoteScriptureRefs(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
  bodyHtml: string
): Promise<void> {
  try {
    const refs = findBibleReferencesInNote(noteHtmlToPlainText(bodyHtml)).slice(0, MAX_REFS_PER_NOTE);

    const { error: deleteError } = await supabase.from("note_scripture_refs").delete().eq("note_id", noteId);
    if (deleteError) return;

    if (refs.length > 0) {
      const { error: insertError } = await supabase.from("note_scripture_refs").insert(
        refs.map((ref) => ({
          user_id: userId,
          note_id: noteId,
          book_order: ref.bookOrder,
          chapter: ref.chapter,
          verse: ref.startVerse,
          end_verse: ref.endVerse,
          snippet: encryptText(ref.snippet),
        }))
      );
      if (insertError) return;
    }

    await supabase.from("notes").update({ scriptures_indexed_at: new Date().toISOString() }).eq("id", noteId);
  } catch {
    // see above — never surfaced
  }
}
