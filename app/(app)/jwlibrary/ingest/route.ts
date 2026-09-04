import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FILES_BUCKET } from "@/lib/storage-config";
import { parseJwlibrary } from "@/lib/jwlibrary/parser";
import { saveJwlibraryBackup } from "@/app/(app)/jwlibrary-actions";

/**
 * Parses and persists a `.jwlibrary` backup entirely server-side — see
 * lib/jwlibrary/parser.ts's top comment for why this differs from the
 * .jwpub flow (which parses in the browser). Triggered fire-and-forget from
 * hooks/use-file-upload.ts right after the normal file upload lands.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sessão expirada." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { noteId?: string };
  const noteId = body.noteId;
  if (!noteId) return Response.json({ error: "noteId ausente." }, { status: 400 });

  // RLS-scoped select IS the ownership check for the note itself.
  const { data: note } = await supabase
    .from("notes")
    .select("id, storage_path")
    .eq("id", noteId)
    .single();
  if (!note?.storage_path) return Response.json({ error: "Arquivo não encontrado." }, { status: 404 });

  // The bucket has no RLS of its own — the path-prefix check is the real
  // ownership control here, same pattern as every other admin-client Storage
  // access in this app (see files-actions.ts).
  if (!note.storage_path.startsWith(`${user.id}/`)) {
    return Response.json({ error: "Acesso negado." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: blob, error: downloadError } = await admin.storage
    .from(FILES_BUCKET)
    .download(note.storage_path);
  if (downloadError || !blob) {
    return Response.json({ error: "Não foi possível baixar o arquivo." }, { status: 500 });
  }

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const parsed = await parseJwlibrary(bytes);
    const result = await saveJwlibraryBackup(noteId, parsed);
    if (result.error) return Response.json({ error: result.error }, { status: 500 });
    return Response.json({ backupId: result.backupId });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Falha ao processar o backup." },
      { status: 500 }
    );
  }
}
