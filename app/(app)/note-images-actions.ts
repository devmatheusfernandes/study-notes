"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  NOTE_IMAGES_BUCKET,
  MAX_IMAGE_SIZE,
  IMAGE_RATE_LIMIT_MAX_UPLOADS,
  IMAGE_RATE_LIMIT_WINDOW_MS,
} from "@/lib/storage-config";

export interface UploadNoteImageResult {
  url?: string;
  error?: string;
}

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/** Same approach as files-actions.ts's countRecentUploads — reads Storage's own timestamps instead of a separate table. */
async function countRecentUploads(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(NOTE_IMAGES_BUCKET).list(userId, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error || !data) return 0;

  const cutoff = Date.now() - IMAGE_RATE_LIMIT_WINDOW_MS;
  return data.filter((f) => f.created_at && new Date(f.created_at).getTime() > cutoff).length;
}

/** Uploads one image pasted/dropped into a note's rich-text body and returns its public URL. */
export async function uploadNoteImage(formData: FormData): Promise<UploadNoteImageResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessão expirada. Entre novamente." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Nenhuma imagem recebida." };

  if (file.size > MAX_IMAGE_SIZE) {
    return { error: `A imagem excede o limite de ${MAX_IMAGE_SIZE / 1024 / 1024} MB.` };
  }

  const ext = extensionOf(file.name);
  const contentType = ALLOWED_IMAGE_EXTENSIONS[ext];
  if (!contentType) return { error: "Formato de imagem não suportado." };

  const recentCount = await countRecentUploads(user.id);
  if (recentCount >= IMAGE_RATE_LIMIT_MAX_UPLOADS) {
    return {
      error: `Limite de envio de imagens atingido (${IMAGE_RATE_LIMIT_MAX_UPLOADS} a cada ${
        IMAGE_RATE_LIMIT_WINDOW_MS / 60_000
      } minutos). Tente novamente em alguns minutos.`,
    };
  }

  const admin = createAdminClient();
  const storagePath = `${user.id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await admin.storage.from(NOTE_IMAGES_BUCKET).upload(storagePath, file, {
    contentType,
    upsert: false,
  });
  if (uploadError) return { error: "Falha ao enviar a imagem." };

  const { data } = admin.storage.from(NOTE_IMAGES_BUCKET).getPublicUrl(storagePath);
  return { url: data.publicUrl };
}

/**
 * Removes images no longer referenced by any note — called when an edit
 * drops an `<img>` from a note's body (see notes-store.ts's `updateNote`)
 * and when a note is deleted outright (see notes-actions.ts). Best-effort:
 * failures here shouldn't block saving/deleting the note itself, so callers
 * don't need to surface this to the user.
 */
export async function deleteNoteImages(paths: string[]): Promise<{ error?: string }> {
  if (paths.length === 0) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  // Ownership by path prefix — same convention as files-actions.ts. Silently
  // drops anything not under the caller's own prefix rather than erroring,
  // since this is best-effort cleanup, not a user-facing operation.
  const owned = paths.filter((p) => p.startsWith(`${user.id}/`));
  if (owned.length === 0) return {};

  const admin = createAdminClient();
  const { error } = await admin.storage.from(NOTE_IMAGES_BUCKET).remove(owned);
  return error ? { error: "Não foi possível remover imagens não utilizadas." } : {};
}
