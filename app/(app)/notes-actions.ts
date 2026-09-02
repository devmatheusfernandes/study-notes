"use server";

import { createClient } from "@/lib/supabase/server";
import { deleteStorageFile } from "./files-actions";
import { deleteNoteImages } from "./note-images-actions";
import { deletePublicationMediaForNote } from "./jwpub-actions";
import { extractNoteImagePaths } from "@/lib/note-images";
import { encryptText, decryptText } from "@/lib/encryption";
import type { NoteType } from "@/lib/file-types";
import { enqueueNoteForVectorization } from "@/lib/vector/queue-actions";

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
  vectorStatus?: "completed" | "pending" | "processing" | "failed" | "none";
  tagIds: string[];
}

export interface FolderRow {
  id: string;
  name: string;
  parentId?: string;
}

export interface TagRow {
  id: string;
  name: string;
  color: string;
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

interface DbTagRow {
  id: string;
  name: string;
  color: string;
}

function mapNote(row: DbNoteRow, vectorStatus?: NoteRow["vectorStatus"], tagIds: string[] = []): NoteRow {
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
    vectorStatus,
    tagIds,
  };
}

function mapFolder(row: DbFolderRow): FolderRow {
  return { id: row.id, name: row.name, parentId: row.parent_id ?? undefined };
}

function mapTag(row: DbTagRow): TagRow {
  return { id: row.id, name: row.name, color: row.color };
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function listUserContent(): Promise<{ notes: NoteRow[]; folders: FolderRow[]; tags: TagRow[] }> {
  const { supabase, user } = await requireUser();
  if (!user) return { notes: [], folders: [], tags: [] };

  const [notesRes, foldersRes, queueRes, embeddingsRes, tagsRes, noteTagsRes] = await Promise.all([
    supabase.from("notes").select("*").order("updated_at", { ascending: false }),
    supabase.from("folders").select("*").order("created_at", { ascending: true }),
    supabase.from("vectorization_queue").select("note_id, status"),
    supabase.from("note_embeddings").select("note_id"),
    supabase.from("tags").select("*").order("created_at", { ascending: true }),
    supabase.from("note_tags").select("note_id, tag_id"),
  ]);

  const queueMap = new Map((queueRes.data ?? []).map((q) => [q.note_id, q.status]));
  const embeddedNoteIds = new Set((embeddingsRes.data ?? []).map((e) => e.note_id));

  const tagsByNote = new Map<string, string[]>();
  for (const row of noteTagsRes.data ?? []) {
    const list = tagsByNote.get(row.note_id) ?? [];
    list.push(row.tag_id);
    tagsByNote.set(row.note_id, list);
  }

  return {
    notes: (notesRes.data ?? []).map((row) => {
      let vectorStatus: NoteRow["vectorStatus"] = "none";
      if (embeddedNoteIds.has(row.id)) {
        vectorStatus = "completed";
      } else if (queueMap.has(row.id)) {
        const qStatus = queueMap.get(row.id);
        if (qStatus === "completed") vectorStatus = "completed";
        else if (qStatus === "failed") vectorStatus = "failed";
        else vectorStatus = "pending";
      }
      return mapNote(row, vectorStatus, tagsByNote.get(row.id) ?? []);
    }),
    folders: (foldersRes.data ?? []).map(mapFolder),
    tags: (tagsRes.data ?? []).map(mapTag),
  };
}

export async function getNoteRow(id: string): Promise<NoteRow | null> {
  const { supabase, user } = await requireUser();
  if (!user) return null;

  const [{ data, error }, { data: noteTags }] = await Promise.all([
    supabase.from("notes").select("*").eq("id", id).single(),
    supabase.from("note_tags").select("tag_id").eq("note_id", id),
  ]);

  if (error || !data) return null;
  return mapNote(data, undefined, (noteTags ?? []).map((t) => t.tag_id));
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

  if (!error) {
    void enqueueNoteForVectorization(input.id);
  }

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
  if (!error) {
    void enqueueNoteForVectorization(id);
  }
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

  const { data: note } = await supabase
    .from("notes")
    .select("storage_path, body, type")
    .eq("id", id)
    .single();
  if (note?.storage_path) await deleteStorageFile(note.storage_path);
  const body = decryptText(note?.body);
  if (body) await deleteNoteImages(extractNoteImagePaths(body));
  // Publication rows cascade from `notes`, but their Storage media doesn't.
  if (note?.type === "jwpub") await deletePublicationMediaForNote(id);

  const { error } = await supabase.from("notes").delete().eq("id", id);
  return error ? { error: "Não foi possível excluir." } : {};
}

export async function bulkDeleteNotesPermanently(ids: string[]): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data: notes } = await supabase.from("notes").select("id, storage_path, body, type").in("id", ids);
  const filePaths = (notes ?? []).map((n) => n.storage_path).filter((p): p is string => !!p);
  const imagePaths = (notes ?? []).flatMap((n) => {
    const body = decryptText(n.body);
    return body ? extractNoteImagePaths(body) : [];
  });
  const publicationIds = (notes ?? []).filter((n) => n.type === "jwpub").map((n) => n.id);
  await Promise.all([
    ...filePaths.map((p) => deleteStorageFile(p)),
    deleteNoteImages(imagePaths),
    ...publicationIds.map((noteId) => deletePublicationMediaForNote(noteId)),
  ]);

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

export async function createTagRow(input: { id: string; name: string; color: string }): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("tags").insert({
    id: input.id,
    user_id: user.id,
    name: input.name,
    color: input.color,
  });

  if (error?.code === "23505") return { error: "Já existe uma tag com esse nome." };
  return error ? { error: "Não foi possível criar a tag." } : {};
}

export async function updateTagRow(id: string, patch: { name?: string; color?: string }): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("tags").update(patch).eq("id", id);
  if (error?.code === "23505") return { error: "Já existe uma tag com esse nome." };
  return error ? { error: "Não foi possível atualizar a tag." } : {};
}

/** `note_tags` rows for this tag cascade automatically via the FK. */
export async function deleteTagRow(id: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("tags").delete().eq("id", id);
  return error ? { error: "Não foi possível excluir a tag." } : {};
}

export async function addTagToNote(noteId: string, tagId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase
    .from("note_tags")
    .upsert({ note_id: noteId, tag_id: tagId, user_id: user.id }, { onConflict: "note_id,tag_id" });
  return error ? { error: "Não foi possível aplicar a tag." } : {};
}

export async function removeTagFromNote(noteId: string, tagId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("note_tags").delete().eq("note_id", noteId).eq("tag_id", tagId);
  return error ? { error: "Não foi possível remover a tag." } : {};
}

/** Settings "danger zone" — promotes every note out of its folder, then removes every folder for this user (all statuses, RLS-scoped). */
export async function deleteAllFoldersRows(): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  await supabase.from("notes").update({ folder_id: null }).not("folder_id", "is", null);
  const { error } = await supabase.from("folders").delete().not("id", "is", null);
  return error ? { error: "Não foi possível excluir as pastas." } : {};
}

/** Settings "danger zone" — removes every tag for this user; `note_tags` rows cascade via the FK. */
export async function deleteAllTagsRows(): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("tags").delete().not("id", "is", null);
  return error ? { error: "Não foi possível excluir as tags." } : {};
}

/** Additive-only bulk assignment — never removes a tag a note already has. */
export async function assignTagsToNotes(noteIds: string[], tagIds: string[]): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const rows = noteIds.flatMap((noteId) =>
    tagIds.map((tagId) => ({ note_id: noteId, tag_id: tagId, user_id: user.id }))
  );
  if (rows.length === 0) return {};

  const { error } = await supabase.from("note_tags").upsert(rows, { onConflict: "note_id,tag_id" });
  return error ? { error: "Não foi possível aplicar as tags." } : {};
}
