"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptText, decryptText } from "@/lib/encryption";
import { MAX_AUDIO_SIZE, NOTE_AUDIO_BUCKET } from "@/lib/storage-config";

export interface DrawingRow {
  strokes: string;
  audioPath: string | null;
  audioDurationMs: number | null;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function getDrawing(noteId: string): Promise<DrawingRow | null> {
  const { supabase, user } = await requireUser();
  if (!user) return null;

  const { data } = await supabase
    .from("note_drawings")
    .select("strokes, audio_path, audio_duration_ms")
    .eq("note_id", noteId)
    .maybeSingle();

  if (!data) return null;
  return {
    strokes: decryptText(data.strokes) ?? "",
    audioPath: data.audio_path,
    audioDurationMs: data.audio_duration_ms,
  };
}

export async function saveDrawing(noteId: string, strokes: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };

  // `note_drawings` is keyed by note_id, so without this a caller could claim
  // the row for a note that isn't theirs (RLS would happily accept it, since
  // the row's own user_id is their own) and the real owner's saves would then
  // collide with a row RLS won't let them update.
  const { data: note } = await supabase.from("notes").select("id").eq("id", noteId).maybeSingle();
  if (!note) return { error: "Nota não encontrada." };

  const { error } = await supabase
    .from("note_drawings")
    .upsert({ note_id: noteId, user_id: user.id, strokes: encryptText(strokes) }, { onConflict: "note_id" });

  return error ? { error: "Não foi possível salvar o desenho." } : {};
}

export interface AudioUploadSlot {
  storagePath?: string;
  token?: string;
  error?: string;
}

/**
 * Step 1 of the direct-to-Storage audio upload, mirroring
 * `requestFileUploadSlots` in files-actions.ts — a recording routinely
 * outgrows Vercel's ~4.5 MB Serverless request-body cap, so the bytes must
 * never travel through a Server Action. The signed URL is the browser's only
 * authorization; the admin credentials that issue it stay server-side.
 */
export async function requestAudioUploadSlot(
  noteId: string,
  extension: "webm" | "mp4"
): Promise<AudioUploadSlot> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };
  if (extension !== "webm" && extension !== "mp4") return { error: "Formato de áudio não suportado." };

  // The note must exist and be this user's — RLS already scopes the select,
  // so a miss means "not yours" just as much as "not there".
  const { data: note } = await supabase.from("notes").select("id").eq("id", noteId).maybeSingle();
  if (!note) return { error: "Nota não encontrada." };

  const admin = createAdminClient();
  const storagePath = `${user.id}/${noteId}/${randomUUID()}.${extension}`;
  const { data, error } = await admin.storage.from(NOTE_AUDIO_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) return { error: "Não foi possível preparar o envio do áudio." };

  return { storagePath, token: data.token };
}

/**
 * Step 2, once the bytes have landed. Re-checks the object's *actual* size
 * (a signed upload URL can't cap it) and drops the drawing's previous
 * recording, so a note never accumulates orphaned audio across re-records.
 */
export async function finalizeAudioUpload(
  noteId: string,
  storagePath: string,
  durationMs: number
): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };
  if (!storagePath.startsWith(`${user.id}/${noteId}/`)) return { error: "Acesso negado." };

  const admin = createAdminClient();
  const slashIndex = storagePath.lastIndexOf("/");
  const dir = storagePath.slice(0, slashIndex);
  const base = storagePath.slice(slashIndex + 1);

  const { data: listing } = await admin.storage.from(NOTE_AUDIO_BUCKET).list(dir, { search: base });
  const actualSize = listing?.find((o) => o.name === base)?.metadata?.size as number | undefined;

  if (actualSize === undefined) {
    return { error: "O envio do áudio não chegou ao armazenamento." };
  }
  if (actualSize > MAX_AUDIO_SIZE) {
    await admin.storage.from(NOTE_AUDIO_BUCKET).remove([storagePath]);
    return { error: `A gravação excede o limite de ${MAX_AUDIO_SIZE / 1024 / 1024} MB.` };
  }

  const { data: previous } = await supabase
    .from("note_drawings")
    .select("audio_path")
    .eq("note_id", noteId)
    .maybeSingle();

  const { error } = await supabase.from("note_drawings").upsert(
    {
      note_id: noteId,
      user_id: user.id,
      audio_path: storagePath,
      audio_duration_ms: Math.round(durationMs),
    },
    { onConflict: "note_id" }
  );
  if (error) return { error: "Não foi possível salvar a gravação." };

  if (previous?.audio_path && previous.audio_path !== storagePath) {
    await admin.storage.from(NOTE_AUDIO_BUCKET).remove([previous.audio_path]);
  }

  return {};
}

/**
 * Playback URL. Far longer-lived than `getFileUrl`'s 60s: a media element
 * keeps issuing range requests for the whole length of a recording, so a
 * short-lived URL would break playback partway through an hour-long one.
 */
export async function getAudioUrl(storagePath: string): Promise<{ url?: string; error?: string }> {
  const { user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  if (!storagePath.startsWith(`${user.id}/`)) return { error: "Acesso negado." };

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(NOTE_AUDIO_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 4);

  return error || !data ? { error: "Não foi possível carregar o áudio." } : { url: data.signedUrl };
}

export async function deleteDrawingAudio(noteId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data } = await supabase
    .from("note_drawings")
    .select("audio_path")
    .eq("note_id", noteId)
    .maybeSingle();

  if (data?.audio_path?.startsWith(`${user.id}/`)) {
    const admin = createAdminClient();
    await admin.storage.from(NOTE_AUDIO_BUCKET).remove([data.audio_path]);
  }

  const { error } = await supabase
    .from("note_drawings")
    .update({ audio_path: null, audio_duration_ms: null })
    .eq("note_id", noteId);

  return error ? { error: "Não foi possível remover a gravação." } : {};
}

/**
 * Storage sweep for a note being deleted for good. The `note_drawings` row
 * itself cascades from `notes`, but its audio object doesn't — same split as
 * `deletePublicationMediaForNote` for jwpub media. Best-effort: a failure
 * here leaves reclaimable bytes, never lost note content.
 */
export async function deleteDrawingAudioForNotes(noteIds: string[]): Promise<void> {
  if (noteIds.length === 0) return;

  const { supabase, user } = await requireUser();
  if (!user) return;

  const { data } = await supabase
    .from("note_drawings")
    .select("audio_path")
    .in("note_id", noteIds)
    .not("audio_path", "is", null);

  const paths = (data ?? [])
    .map((row) => row.audio_path as string)
    .filter((path) => path.startsWith(`${user.id}/`));
  if (paths.length === 0) return;

  const admin = createAdminClient();
  await admin.storage.from(NOTE_AUDIO_BUCKET).remove(paths);
}
