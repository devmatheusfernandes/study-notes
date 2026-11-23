import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptText } from "@/lib/encryption";

/**
 * References inside a note shared with the caller point at the OWNER's
 * private library (imported publications, their excerpts, other notes) —
 * which RLS rightly hides from everyone else. To open them anyway, the server
 * reads them with the service role, but only:
 *  - for a caller the database says has access to that shared note
 *    (`note_share_role`: editor/viewer — the owner reads their own library
 *    normally), and
 *  - for a target the shared note's own text actually cites
 *    (`citesAttribute`), and
 *  - from rows owned by that note's owner (each query filters `user_id`).
 * So a shared note exposes exactly what it cites, never the library around it.
 */
export async function sharedNoteContext(
  supabase: SupabaseClient,
  sharedNoteId: string
): Promise<{ ownerId: string; body: string } | null> {
  const { data: role, error } = await supabase.rpc("note_share_role", { p_note_id: sharedNoteId });
  if (error || (role !== "editor" && role !== "viewer")) return null;
  const { data: note } = await supabase.from("notes").select("user_id, body").eq("id", sharedNoteId).maybeSingle();
  if (!note) return null;
  return { ownerId: note.user_id as string, body: decryptText(note.body as string) ?? "" };
}

/** Whether the note's HTML carries this reference attribute with exactly this value. */
export function citesAttribute(body: string, attribute: string, value: string | number): boolean {
  const escaped = String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return body.includes(`${attribute}="${escaped}"`);
}
