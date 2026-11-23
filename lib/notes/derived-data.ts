import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncNoteScriptureRefs } from "@/lib/bible/note-scripture-sync";

/**
 * Re-derives what hangs off a note's text — the vectorization queue entry and
 * the scripture citation index — after its body was saved.
 *
 * Both belong to the note's OWNER even when a collaborator made the edit:
 * enqueuing under the editor's id would move the owner's embeddings to the
 * editor (and out of the owner's assistant search), and the owner's Bible
 * "Pessoal" tab reads citations by its own user_id.
 *
 * For the owner this goes through the per-request client (RLS-scoped). For a
 * collaborator it uses the service-role client — the caller MUST already have
 * verified the session and written the body under RLS (the `notes_shared_update`
 * policy only lets an editor through), and passes the owner id read back from
 * that very row.
 */
export async function refreshNoteDerivedData(
  supabase: SupabaseClient,
  callerId: string,
  noteId: string,
  ownerId: string,
  body: string | undefined
): Promise<void> {
  const client = ownerId === callerId ? supabase : createAdminClient();
  try {
    await client.from("vectorization_queue").upsert(
      {
        user_id: ownerId,
        note_id: noteId,
        status: "pending",
        attempts: 0,
        error: null,
        total_chunks: null,
        processed_chunks: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "note_id" }
    );
  } catch {
    // best-effort, like the rest of the derived data
  }
  if (body !== undefined) await syncNoteScriptureRefs(client, ownerId, noteId, body);
}
