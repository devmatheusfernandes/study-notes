"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { typeFromFileName, formatFileSize, type NoteType } from "@/lib/file-types";
import { encryptText, decryptText } from "@/lib/encryption";
import { enqueueNoteForVectorization } from "@/lib/vector/queue-actions";
import {
  ALLOWED_EXTENSIONS,
  FILES_BUCKET,
  MAX_FILES_PER_BATCH,
  maxSizeForExtension,
  RATE_LIMIT_MAX_UPLOADS,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/storage-config";

export interface UploadedFile {
  id: string;
  type: NoteType;
  title: string;
  body: string;
  storagePath: string;
  updatedAt: number;
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

export interface UploadSlot {
  fileName: string;
  storagePath: string;
  signedUrl: string;
  token: string;
}

export interface RequestUploadSlotsResult {
  slots: UploadSlot[];
  error?: string;
}

/**
 * Step 1 of the direct-to-Storage upload: does every check `uploadFiles`
 * used to do up front (extension, per-extension size cap, rate limit) —
 * this is still the ONLY place any of that is enforced before Storage will
 * accept bytes for a given path — then hands back one signed upload URL per
 * file. `createSignedUploadUrl` needs the admin client (the `files` bucket
 * has no RLS policies of its own — every other access here already goes
 * through this same admin client, see getFileUrl/deleteStorageFile below),
 * but the signed URL itself is the authorization for the follow-up PUT —
 * the browser never needs, or gets, the admin credentials themselves.
 */
export async function requestFileUploadSlots(
  files: { name: string; size: number }[]
): Promise<RequestUploadSlotsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { slots: [], error: "Sessão expirada. Entre novamente." };
  if (files.length === 0) return { slots: [], error: "Nenhum arquivo recebido." };
  if (files.length > MAX_FILES_PER_BATCH) {
    return { slots: [], error: `Envie no máximo ${MAX_FILES_PER_BATCH} arquivos por vez.` };
  }

  for (const file of files) {
    const ext = extensionOf(file.name);
    if (!(ext in ALLOWED_EXTENSIONS)) {
      return { slots: [], error: `"${file.name}" tem um tipo de arquivo não suportado.` };
    }
    const maxSize = maxSizeForExtension(ext);
    if (file.size > maxSize) {
      return { slots: [], error: `"${file.name}" excede o limite de ${maxSize / 1024 / 1024} MB.` };
    }
  }

  const recentCount = await countRecentUploads(user.id);
  if (recentCount + files.length > RATE_LIMIT_MAX_UPLOADS) {
    return {
      slots: [],
      error: `Limite de envio atingido (${RATE_LIMIT_MAX_UPLOADS} arquivos a cada ${
        RATE_LIMIT_WINDOW_MS / 60_000
      } minutos). Tente novamente em alguns minutos.`,
    };
  }

  const admin = createAdminClient();
  const slots: UploadSlot[] = [];

  for (const file of files) {
    const storagePath = `${user.id}/${randomUUID()}-${sanitizeFileName(file.name)}`;
    const { data, error } = await admin.storage.from(FILES_BUCKET).createSignedUploadUrl(storagePath);
    if (error || !data) {
      return { slots, error: `Não foi possível preparar o envio de "${file.name}".` };
    }
    slots.push({ fileName: file.name, storagePath, signedUrl: data.signedUrl, token: data.token });
  }

  return { slots };
}

export interface FinalizeUploadResult {
  file?: UploadedFile;
  error?: string;
}

/**
 * Step 2: called once the browser has PUT the actual bytes straight to the
 * signed URL from `requestFileUploadSlots`. `createSignedUploadUrl` has no
 * way to cap the upload's size itself, so a client that skipped this app
 * and hit the signed URL directly could otherwise slip past the size check
 * that used to happen before any bytes moved — this re-checks the object's
 * *actual* landed size against the same per-extension cap and deletes it on
 * a violation, rather than trusting whatever the caller claims here.
 */
export async function finalizeFileUpload(
  storagePath: string,
  fileName: string,
  folderId?: string
): Promise<FinalizeUploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessão expirada. Entre novamente." };
  if (!storagePath.startsWith(`${user.id}/`)) return { error: "Acesso negado." };

  const admin = createAdminClient();
  const slashIndex = storagePath.indexOf("/");
  const dir = storagePath.slice(0, slashIndex);
  const base = storagePath.slice(slashIndex + 1);

  const { data: listing } = await admin.storage.from(FILES_BUCKET).list(dir, { search: base });
  const actualSize = listing?.find((o) => o.name === base)?.metadata?.size as number | undefined;

  if (actualSize === undefined) {
    return { error: `Falha ao registrar "${fileName}" — o envio não chegou ao armazenamento.` };
  }

  const ext = extensionOf(fileName);
  const maxSize = maxSizeForExtension(ext);
  if (actualSize > maxSize) {
    await admin.storage.from(FILES_BUCKET).remove([storagePath]);
    return { error: `"${fileName}" excede o limite de ${maxSize / 1024 / 1024} MB.` };
  }

  const { data: row, error: dbError } = await supabase
    .from("notes")
    .insert({
      user_id: user.id,
      type: typeFromFileName(fileName),
      title: encryptText(fileName),
      body: encryptText(formatFileSize(actualSize)),
      storage_path: storagePath,
      folder_id: folderId ?? null,
    })
    .select("id, type, title, body, storage_path, updated_at")
    .single();

  if (dbError || !row) {
    // The file made it to Storage but has no note row — clean up rather
    // than leave an orphaned object the user can never see or delete.
    await admin.storage.from(FILES_BUCKET).remove([storagePath]);
    return { error: `Falha ao registrar "${fileName}".` };
  }

  void enqueueNoteForVectorization(row.id);

  return {
    file: {
      id: row.id,
      type: row.type as NoteType,
      title: decryptText(row.title) ?? "",
      body: decryptText(row.body) ?? "",
      storagePath: row.storage_path!,
      updatedAt: new Date(row.updated_at).getTime(),
    },
  };
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
