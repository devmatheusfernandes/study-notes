"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ALLOWED_EXTENSIONS,
  FILES_BUCKET,
  MAX_FILE_SIZE,
  MAX_FILES_PER_BATCH,
  RATE_LIMIT_MAX_UPLOADS,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/storage-config";

export interface UploadedFile {
  name: string;
  size: number;
  storagePath: string;
}

export interface UploadFilesResult {
  files: UploadedFile[];
  error?: string;
}

function sanitizeFileName(name: string) {
  const trimmed = name.trim().slice(-120); // last 120 chars — keeps the extension even for very long names
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Counts the user's uploads within the rate-limit window by reading Storage's
 * own object timestamps — avoids standing up a separate Postgres table just
 * for this. Cheap at this app's scale (a few hundred objects per user, tops).
 */
async function countRecentUploads(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(FILES_BUCKET).list(userId, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error || !data) return 0;

  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  return data.filter((f) => f.created_at && new Date(f.created_at).getTime() > cutoff).length;
}

export async function uploadFiles(formData: FormData): Promise<UploadFilesResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { files: [], error: "Sessão expirada. Entre novamente." };
  }

  const incoming = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (incoming.length === 0) {
    return { files: [], error: "Nenhum arquivo recebido." };
  }
  if (incoming.length > MAX_FILES_PER_BATCH) {
    return { files: [], error: `Envie no máximo ${MAX_FILES_PER_BATCH} arquivos por vez.` };
  }

  for (const file of incoming) {
    if (file.size > MAX_FILE_SIZE) {
      return {
        files: [],
        error: `"${file.name}" excede o limite de ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      };
    }
    const ext = extensionOf(file.name);
    if (!(ext in ALLOWED_EXTENSIONS)) {
      return { files: [], error: `"${file.name}" tem um tipo de arquivo não suportado.` };
    }
  }

  const recentCount = await countRecentUploads(user.id);
  if (recentCount + incoming.length > RATE_LIMIT_MAX_UPLOADS) {
    return {
      files: [],
      error: `Limite de envio atingido (${RATE_LIMIT_MAX_UPLOADS} arquivos a cada ${
        RATE_LIMIT_WINDOW_MS / 60_000
      } minutos). Tente novamente em alguns minutos.`,
    };
  }

  const admin = createAdminClient();
  const uploaded: UploadedFile[] = [];

  for (const file of incoming) {
    const ext = extensionOf(file.name);
    const contentType = ALLOWED_EXTENSIONS[ext];
    const storagePath = `${user.id}/${randomUUID()}-${sanitizeFileName(file.name)}`;

    const { error } = await admin.storage.from(FILES_BUCKET).upload(storagePath, file, {
      contentType,
      upsert: false,
    });

    if (error) {
      // Best-effort batch: report what succeeded, surface the first failure.
      return {
        files: uploaded,
        error: `Falha ao enviar "${file.name}". ${uploaded.length > 0 ? "Os demais arquivos foram enviados." : ""}`,
      };
    }

    uploaded.push({ name: file.name, size: file.size, storagePath });
  }

  return { files: uploaded };
}

/** Ownership is enforced by path prefix — every object lives under `${userId}/...`. */
async function assertOwnedPath(storagePath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !storagePath.startsWith(`${user.id}/`)) {
    return null;
  }
  return user;
}

export async function getFileUrl(storagePath: string): Promise<{ url?: string; error?: string }> {
  const user = await assertOwnedPath(storagePath);
  if (!user) return { error: "Acesso negado." };

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(FILES_BUCKET).createSignedUrl(storagePath, 60);
  if (error || !data) return { error: "Não foi possível abrir o arquivo." };

  return { url: data.signedUrl };
}

export async function deleteStorageFile(storagePath: string): Promise<{ error?: string }> {
  const user = await assertOwnedPath(storagePath);
  if (!user) return { error: "Acesso negado." };

  const admin = createAdminClient();
  const { error } = await admin.storage.from(FILES_BUCKET).remove([storagePath]);
  if (error) return { error: "Não foi possível remover o arquivo do armazenamento." };

  return {};
}
