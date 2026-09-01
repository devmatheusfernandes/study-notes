"use server";

import { createClient } from "@/lib/supabase/server";
import { deleteStorageFile } from "./files-actions";
import { deleteNoteImages } from "./note-images-actions";
import { extractNoteImagePaths } from "@/lib/note-images";
import { encryptText, decryptText } from "@/lib/encryption";
import type { NoteType } from "@/lib/file-types";

export interface NoteRow {
  id: string;
  type: NoteType;
  title: string;
  body: string;
  storagePath?: string;
  pinned: boolean;
  status: "active" | "archived" | "trashed";
  folderId?: string;
  updatedAt: number;
}

export interface FolderRow {
  id: string;
  name: string;
  parentId?: string;
}

interface DbNoteRow {
  id: string;
  type: string;
  title: string;
  body: string;
  storage_path: string | null;
  pinned: boolean;
  status: string;
  folder_id: string | null;
  updated_at: string;
}

interface DbFolderRow {
  id: string;
  name: string;
  parent_id: string | null;
}

function mapNote(row: DbNoteRow): NoteRow {
  return {
    id: row.id,
    type: row.type as NoteType,
    title: decryptText(row.title) ?? "",
    body: decryptText(row.body) ?? "",
    storagePath: row.storage_path ?? undefined,
    pinned: row.pinned,
    status: row.status as NoteRow["status"],
    folderId: row.folder_id ?? undefined,
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function mapFolder(row: DbFolderRow): FolderRow {
  return { id: row.id, name: row.name, parentId: row.parent_id ?? undefined };
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function listUserContent(): Promise<{ notes: NoteRow[]; folders: FolderRow[] }> {
  const { supabase, user } = await requireUser();
  if (!user) return { notes: [], folders: [] };

  const [notesRes, foldersRes] = await Promise.all([
    supabase.from("notes").select("*").order("updated_at", { ascending: false }),
    supabase.from("folders").select("*").order("created_at", { ascending: true }),
  ]);

  return {
    notes: (notesRes.data ?? []).map(mapNote),
    folders: (foldersRes.data ?? []).map(mapFolder),
  };
}

export async function createNoteRow(input: {
  id: string;
  title: string;
  body: string;
  folderId?: string;
}): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };

  const { error } = await supabase.from("notes").insert({
    id: input.id,
    user_id: user.id,
    title: encryptText(input.title),
    body: encryptText(input.body),
    folder_id: input.folderId ?? null,
    type: "nota",
  });

  return error ? { error: "Não foi possível salvar a nota." } : {};
}

export async function updateNoteRow(
  id: string,
  patch: { title?: string; body?: string }
): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };

  const encryptedPatch: { title?: string | null; body?: string | null } = {};
  if (patch.title !== undefined) encryptedPatch.title = encryptText(patch.title);
  if (patch.body !== undefined) encryptedPatch.body = encryptText(patch.body);

  const { error } = await supabase.from("notes").update(encryptedPatch).eq("id", id);
  return error ? { error: "Não foi possível salvar." } : {};
}

export async function setNotePinned(id: string, pinned: boolean): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("notes").update({ pinned }).eq("id", id);
  return error ? { error: "Não foi possível atualizar." } : {};
}

type NoteStatus = "active" | "archived" | "trashed";

export async function setNoteStatus(id: string, status: NoteStatus): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const patch: { status: NoteStatus; pinned?: boolean } = { status };
  if (status !== "active") patch.pinned = false;

  const { error } = await supabase.from("notes").update(patch).eq("id", id);
  return error ? { error: "Não foi possível atualizar." } : {};
}

export async function bulkSetNoteStatus(ids: string[], status: NoteStatus): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const patch: { status: NoteStatus; pinned?: boolean } = { status };
  if (status !== "active") patch.pinned = false;

  const { error } = await supabase.from("notes").update(patch).in("id", ids);
  return error ? { error: "Não foi possível atualizar." } : {};
}

export async function deleteNotePermanently(id: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data: note } = await supabase.from("notes").select("storage_path, body").eq("id", id).single();
  if (note?.storage_path) await deleteStorageFile(note.storage_path);
  const body = decryptText(note?.body);
  if (body) await deleteNoteImages(extractNoteImagePaths(body));

  const { error } = await supabase.from("notes").delete().eq("id", id);
  return error ? { error: "Não foi possível excluir." } : {};
}

export async function bulkDeleteNotesPermanently(ids: string[]): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data: notes } = await supabase.from("notes").select("storage_path, body").in("id", ids);
  const filePaths = (notes ?? []).map((n) => n.storage_path).filter((p): p is string => !!p);
  const imagePaths = (notes ?? []).flatMap((n) => {
    const body = decryptText(n.body);
    return body ? extractNoteImagePaths(body) : [];
  });
  await Promise.all([...filePaths.map((p) => deleteStorageFile(p)), deleteNoteImages(imagePaths)]);

  const { error } = await supabase.from("notes").delete().in("id", ids);
  return error ? { error: "Não foi possível excluir." } : {};
}

export async function createFolderRow(input: {
  id: string;
  name: string;
  parentId?: string;
}): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("folders").insert({
    id: input.id,
    user_id: user.id,
    name: input.name,
    parent_id: input.parentId ?? null,
  });

  return error ? { error: "Não foi possível criar a pasta." } : {};
}

export async function renameFolderRow(id: string, name: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("folders").update({ name }).eq("id", id);
  return error ? { error: "Não foi possível renomear a pasta." } : {};
}

/** Deleting a folder promotes its notes and any nested subfolders to its own parent — nothing inside is deleted. */
export async function deleteFolderRow(id: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data: folder } = await supabase.from("folders").select("parent_id").eq("id", id).single();
  const parentId = folder?.parent_id ?? null;

  await supabase.from("folders").update({ parent_id: parentId }).eq("parent_id", id);
  await supabase.from("notes").update({ folder_id: parentId }).eq("folder_id", id);

  const { error } = await supabase.from("folders").delete().eq("id", id);
  return error ? { error: "Não foi possível excluir a pasta." } : {};
}
