"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptText, decryptText } from "@/lib/encryption";
import { extractNoteImagePaths, noteImageUrl } from "@/lib/note-images";
import { NOTE_IMAGES_BUCKET } from "@/lib/storage-config";
import { refreshNoteDerivedData } from "@/lib/notes/derived-data";

/*
 * Sharing notes and folders (see supabase/migrations/0055_sharing.sql).
 *
 * The database decides who sees what: `shared_note_access()` /
 * `shared_folder_access()` recompute access on every read, so a note created
 * in a shared folder later is included and a locked one drops out with no
 * code here. These actions only manage the `shares` rows and read through the
 * RLS-scoped client; the service-role client is used for exactly three things,
 * each after the caller's session and access have been verified: resolving an
 * invite's e-mail to an account, showing an invitee the title of what they're
 * being invited to (they can't read it under RLS until they accept), and
 * copying image objects into the importer's own Storage prefix.
 */

export type ShareRole = "editor" | "viewer";
export type ShareStatus = "pending" | "accepted" | "declined" | "revoked" | "left";
export type ShareTarget = { noteId: string } | { folderId: string };

export interface ShareMember {
  id: string;
  email: string;
  name?: string;
  role: ShareRole;
  status: ShareStatus;
}

/** People who get this note/folder through a shared folder above it (managed on that folder). */
export interface InheritedShare {
  folderId: string;
  folderName: string;
  members: ShareMember[];
}

export interface IncomingInvite {
  id: string;
  kind: "note" | "folder";
  title: string;
  role: ShareRole;
  ownerName: string;
}

export interface SharedNote {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
  /** Only set when that folder is itself visible to the caller (part of a shared tree). */
  folderId?: string;
  role: ShareRole;
  shareId: string;
  ownerName: string;
}

export interface SharedFolder {
  id: string;
  name: string;
  /** Only set when the parent is itself shared with the caller — else this is a share root. */
  parentId?: string;
  role: ShareRole;
  shareId: string;
  ownerName: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IMPORT_IMAGES = 300;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

function nameOf(profile: { email: string; display_name: string } | undefined) {
  if (!profile) return "Alguém";
  return profile.display_name || profile.email.split("@")[0] || profile.email;
}

async function peerProfiles(supabase: Supabase) {
  const { data } = await supabase.rpc("share_peer_profiles");
  return new Map(((data ?? []) as { id: string; email: string; display_name: string }[]).map((p) => [p.id, p]));
}

/** True when this folder (or any folder above it) is locked. Owner's own folders only. */
async function folderChainLocked(supabase: Supabase, userId: string, folderId: string | null): Promise<boolean> {
  if (!folderId) return false;
  const { data: folders } = await supabase.from("folders").select("id, parent_id, locked").eq("user_id", userId);
  const byId = new Map((folders ?? []).map((f) => [f.id as string, f]));
  const seen = new Set<string>();
  let cursor: string | null = folderId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const folder = byId.get(cursor);
    if (!folder) return false;
    if (folder.locked) return true;
    cursor = folder.parent_id as string | null;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Owner side
// ---------------------------------------------------------------------------

/**
 * Invites someone by e-mail. Always answers the same way whether or not the
 * address has an account (no account enumeration); an invite to an address
 * with no account waits for whoever signs up with it.
 */
export async function inviteToShare(
  target: ShareTarget,
  rawEmail: string,
  role: ShareRole
): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };

  const email = String(rawEmail ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 320) return { error: "Informe um e-mail válido." };
  if (role !== "editor" && role !== "viewer") return { error: "Permissão inválida." };
  if (email === (user.email ?? "").toLowerCase()) return { error: "Você não pode compartilhar com você mesmo." };

  if ("noteId" in target) {
    const { data: note } = await supabase
      .from("notes")
      .select("id, type, locked, folder_id, status")
      .eq("id", target.noteId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!note) return { error: "Nota não encontrada." };
    if (note.type !== "nota") return { error: "Só notas de texto podem ser compartilhadas." };
    if (note.locked || (await folderChainLocked(supabase, user.id, note.folder_id))) {
      return { error: "Notas trancadas não podem ser compartilhadas." };
    }
  } else {
    const { data: folder } = await supabase
      .from("folders")
      .select("id")
      .eq("id", target.folderId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!folder) return { error: "Pasta não encontrada." };
    if (await folderChainLocked(supabase, user.id, target.folderId)) {
      return { error: "Pastas trancadas não podem ser compartilhadas." };
    }
  }

  // Resolving the address needs to see every profile — service role, after
  // the checks above. The answer never reaches the client.
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  const inviteeId = (profile?.id as string | undefined) ?? null;

  const column = "noteId" in target ? "note_id" : "folder_id";
  const targetId = "noteId" in target ? target.noteId : target.folderId;

  const { data: existing } = await supabase
    .from("shares")
    .select("id, status")
    .eq(column, targetId)
    .eq("invitee_email", email)
    .maybeSingle();

  if (existing) {
    // Re-inviting after a decline/leave asks again; an accepted share just changes role.
    const patch: { role: ShareRole; status?: ShareStatus } = { role };
    if (existing.status !== "accepted" && existing.status !== "pending") patch.status = "pending";
    const { error } = await supabase.from("shares").update(patch).eq("id", existing.id);
    if (error) return { error: "Não foi possível enviar o convite." };
    return {};
  }

  const { error } = await supabase.from("shares").insert({
    owner_id: user.id,
    [column]: targetId,
    invitee_email: email,
    invitee_id: inviteeId,
    role,
  });
  if (error) return { error: "Não foi possível enviar o convite." };
  return {};
}

export async function listShareMembers(
  target: ShareTarget
): Promise<{ members: ShareMember[]; inherited: InheritedShare[]; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { members: [], inherited: [], error: "Sessão expirada." };

  const column = "noteId" in target ? "note_id" : "folder_id";
  const targetId = "noteId" in target ? target.noteId : target.folderId;
  const [{ data, error }, peers, { data: folders }, { data: note }] = await Promise.all([
    supabase
      .from("shares")
      .select("id, invitee_email, invitee_id, role, status")
      .eq("owner_id", user.id)
      .eq(column, targetId)
      .order("created_at", { ascending: true }),
    peerProfiles(supabase),
    supabase.from("folders").select("id, name, parent_id").eq("user_id", user.id),
    "noteId" in target
      ? supabase.from("notes").select("folder_id").eq("id", target.noteId).eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (error) return { members: [], inherited: [], error: "Não foi possível carregar." };

  const toMember = (row: Record<string, unknown>): ShareMember => {
    const profile = row.invitee_id ? peers.get(row.invitee_id as string) : undefined;
    return {
      id: row.id as string,
      email: row.invitee_email as string,
      name: profile ? nameOf(profile) : undefined,
      role: row.role as ShareRole,
      status: row.status as ShareStatus,
    };
  };

  // Folders above the target: a share on any of them also covers it (the
  // database computes access through the whole tree), so the vault shows them.
  const byId = new Map((folders ?? []).map((f) => [f.id as string, f]));
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null =
    "noteId" in target
      ? ((note as { folder_id: string | null } | null)?.folder_id ?? null)
      : ((byId.get(target.folderId)?.parent_id as string | null) ?? null);
  while (cursor && !seen.has(cursor) && byId.has(cursor)) {
    seen.add(cursor);
    ancestors.push(cursor);
    cursor = (byId.get(cursor)!.parent_id as string | null) ?? null;
  }

  let inherited: InheritedShare[] = [];
  if (ancestors.length > 0) {
    const { data: rows } = await supabase
      .from("shares")
      .select("id, folder_id, invitee_email, invitee_id, role, status")
      .eq("owner_id", user.id)
      .in("folder_id", ancestors)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: true });
    inherited = ancestors
      .map((folderId) => ({
        folderId,
        folderName: (byId.get(folderId)?.name as string) ?? "Pasta",
        members: (rows ?? []).filter((r) => r.folder_id === folderId).map(toMember),
      }))
      .filter((group) => group.members.length > 0);
  }

  return { members: (data ?? []).map(toMember), inherited };
}

/**
 * Creates a note inside a folder someone shared with the caller (as editor).
 * The note belongs to the FOLDER'S OWNER — that's what puts it in the shared
 * tree, so everyone with the folder sees it, and it stays when the creator
 * leaves. The insert uses the service role (RLS rightly won't let a user
 * insert rows owned by someone else), only after the session is verified and
 * the database itself confirms editor access to that exact folder.
 */
export async function createNoteInSharedFolder(input: {
  id: string;
  folderId: string;
  title: string;
  body: string;
}): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) return { error: "Nota inválida." };
  if (typeof input.title !== "string" || typeof input.body !== "string") return { error: "Dados inválidos." };

  const { data: access, error: accessError } = await supabase.rpc("shared_folder_access");
  if (accessError) return { error: "Não foi possível criar a nota." };
  const entry = ((access ?? []) as { folder_id: string; role: ShareRole; owner_id: string }[]).find(
    (a) => a.folder_id === input.folderId
  );
  if (!entry) return { error: "Pasta não encontrada." };
  if (entry.role !== "editor") return { error: "Você só pode ver esta pasta." };

  const admin = createAdminClient();
  const { error } = await admin.from("notes").insert({
    id: input.id,
    user_id: entry.owner_id,
    folder_id: input.folderId,
    type: "nota",
    title: encryptText(input.title.trim() || "Nova nota"),
    body: encryptText(input.body),
  });
  if (error) return { error: "Não foi possível criar a nota." };
  await refreshNoteDerivedData(supabase, user.id, input.id, entry.owner_id, input.body);
  return {};
}

export async function updateShareRole(shareId: string, role: ShareRole): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  if (role !== "editor" && role !== "viewer") return { error: "Permissão inválida." };
  const { error } = await supabase.from("shares").update({ role }).eq("id", shareId).eq("owner_id", user.id);
  return error ? { error: "Não foi possível atualizar." } : {};
}

/** The owner stops sharing with this person. Deleting (not just flagging) lets a later invite start clean. */
export async function revokeShare(shareId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  const { error } = await supabase.from("shares").delete().eq("id", shareId).eq("owner_id", user.id);
  return error ? { error: "Não foi possível remover." } : {};
}

/** Which of the caller's own notes/folders are shared (pending or accepted) — drives the "compartilhada" mark on cards. */
export async function listMyOutgoingShares(): Promise<{ noteIds: string[]; folderIds: string[] }> {
  const { supabase, user } = await requireUser();
  if (!user) return { noteIds: [], folderIds: [] };
  const { data } = await supabase
    .from("shares")
    .select("note_id, folder_id")
    .eq("owner_id", user.id)
    .in("status", ["pending", "accepted"]);
  const noteIds = new Set<string>();
  const folderIds = new Set<string>();
  for (const row of data ?? []) {
    if (row.note_id) noteIds.add(row.note_id as string);
    if (row.folder_id) folderIds.add(row.folder_id as string);
  }
  return { noteIds: [...noteIds], folderIds: [...folderIds] };
}

// ---------------------------------------------------------------------------
// Invitee side
// ---------------------------------------------------------------------------

export async function listIncomingInvites(): Promise<{ invites: IncomingInvite[]; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { invites: [], error: "Sessão expirada." };

  const [{ data, error }, peers] = await Promise.all([
    supabase
      .from("shares")
      .select("id, note_id, folder_id, role, owner_id")
      .eq("invitee_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    peerProfiles(supabase),
  ]);
  if (error) return { invites: [], error: "Não foi possível carregar os convites." };
  const rows = data ?? [];
  if (rows.length === 0) return { invites: [] };

  // The invitee can't read the target before accepting; the title shown on
  // the invite is read for them, only for invites addressed to them (above).
  const admin = createAdminClient();
  const noteIds = rows.map((r) => r.note_id).filter(Boolean) as string[];
  const folderIds = rows.map((r) => r.folder_id).filter(Boolean) as string[];
  const [{ data: notes }, { data: folders }] = await Promise.all([
    noteIds.length ? admin.from("notes").select("id, title").in("id", noteIds) : Promise.resolve({ data: [] }),
    folderIds.length ? admin.from("folders").select("id, name").in("id", folderIds) : Promise.resolve({ data: [] }),
  ]);
  const noteTitles = new Map((notes ?? []).map((n) => [n.id as string, decryptText(n.title as string) || "Sem título"]));
  const folderNames = new Map((folders ?? []).map((f) => [f.id as string, f.name as string]));

  return {
    invites: rows.map((r) => ({
      id: r.id as string,
      kind: r.note_id ? "note" : "folder",
      title: r.note_id ? noteTitles.get(r.note_id as string) ?? "Nota" : folderNames.get(r.folder_id as string) ?? "Pasta",
      role: r.role as ShareRole,
      ownerName: nameOf(peers.get(r.owner_id as string)),
    })),
  };
}

export async function respondToInvite(shareId: string, accept: boolean): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  const { error } = await supabase
    .from("shares")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", shareId)
    .eq("invitee_id", user.id)
    .eq("status", "pending");
  return error ? { error: "Não foi possível responder ao convite." } : {};
}

/** The invitee removes a shared item from their list (with or without having imported a copy). */
export async function leaveShare(shareId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  const { error } = await supabase
    .from("shares")
    .update({ status: "left" })
    .eq("id", shareId)
    .eq("invitee_id", user.id)
    .eq("status", "accepted");
  return error ? { error: "Não foi possível remover." } : {};
}

/** Everything currently shared with the caller — recomputed by the database on every call. */
export async function listSharedWithMe(): Promise<{
  notes: SharedNote[];
  folders: SharedFolder[];
  ok: boolean;
}> {
  const { supabase, user } = await requireUser();
  if (!user) return { notes: [], folders: [], ok: false };

  const [noteAccessRes, folderAccessRes, peers] = await Promise.all([
    supabase.rpc("shared_note_access"),
    supabase.rpc("shared_folder_access"),
    peerProfiles(supabase),
  ]);
  if (noteAccessRes.error || folderAccessRes.error) return { notes: [], folders: [], ok: false };

  type Access = { role: ShareRole; share_id: string; owner_id: string };
  const noteAccess = new Map(
    ((noteAccessRes.data ?? []) as (Access & { note_id: string })[]).map((a) => [a.note_id, a])
  );
  const folderAccess = new Map(
    ((folderAccessRes.data ?? []) as (Access & { folder_id: string })[]).map((a) => [a.folder_id, a])
  );

  const [notesRes, foldersRes] = await Promise.all([
    noteAccess.size
      ? supabase.from("notes").select("id, title, body, folder_id, updated_at").in("id", [...noteAccess.keys()])
      : Promise.resolve({ data: [], error: null }),
    folderAccess.size
      ? supabase.from("folders").select("id, name, parent_id").in("id", [...folderAccess.keys()])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (notesRes.error || foldersRes.error) return { notes: [], folders: [], ok: false };

  return {
    ok: true,
    folders: (foldersRes.data ?? []).map((f) => {
      const access = folderAccess.get(f.id as string)!;
      const parentId = f.parent_id as string | null;
      return {
        id: f.id as string,
        name: f.name as string,
        parentId: parentId && folderAccess.has(parentId) ? parentId : undefined,
        role: access.role,
        shareId: access.share_id,
        ownerName: nameOf(peers.get(access.owner_id)),
      };
    }),
    notes: (notesRes.data ?? [])
      .map((n) => {
        const access = noteAccess.get(n.id as string)!;
        const folderId = n.folder_id as string | null;
        return {
          id: n.id as string,
          title: decryptText(n.title as string) ?? "",
          body: decryptText(n.body as string) ?? "",
          updatedAt: new Date(n.updated_at as string).getTime(),
          folderId: folderId && folderAccess.has(folderId) ? folderId : undefined,
          role: access.role,
          shareId: access.share_id,
          ownerName: nameOf(peers.get(access.owner_id)),
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

/**
 * Copies a shared note — or a shared folder's whole tree (minus locked notes,
 * which the database already leaves out) — into the caller's own account.
 * Images are copied into the caller's Storage prefix and the bodies rewritten
 * to point at the copies, so the copy keeps working after the share ends.
 */
export async function importSharedCopy(shareId: string): Promise<{ error?: string; importedNotes?: number }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data: share } = await supabase
    .from("shares")
    .select("id, note_id, folder_id")
    .eq("id", shareId)
    .eq("invitee_id", user.id)
    .eq("status", "accepted")
    .maybeSingle();
  if (!share) return { error: "Compartilhamento não encontrado." };

  const [noteAccessRes, folderAccessRes] = await Promise.all([
    supabase.rpc("shared_note_access"),
    supabase.rpc("shared_folder_access"),
  ]);
  const noteIds = ((noteAccessRes.data ?? []) as { note_id: string; share_id: string; via_folder: boolean }[])
    .filter((a) => a.share_id === shareId)
    .map((a) => a.note_id);
  const folderIds = ((folderAccessRes.data ?? []) as { folder_id: string; share_id: string }[])
    .filter((a) => a.share_id === shareId)
    .map((a) => a.folder_id);
  if (noteIds.length === 0 && folderIds.length === 0) return { error: "Nada para importar." };

  const [{ data: notes }, { data: folders }] = await Promise.all([
    noteIds.length
      ? supabase.from("notes").select("id, title, body, folder_id").in("id", noteIds)
      : Promise.resolve({ data: [] }),
    folderIds.length
      ? supabase.from("folders").select("id, name, parent_id").in("id", folderIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Folders: same shape, new ids. Parents first so every insert finds its parent.
  const folderIdMap = new Map<string, string>();
  const pending = [...(folders ?? [])];
  const inTree = new Set(folderIds);
  let guard = pending.length + 1;
  while (pending.length && guard-- > 0) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const f = pending[i];
      const parent = f.parent_id as string | null;
      const parentInTree = parent && inTree.has(parent);
      if (parentInTree && !folderIdMap.has(parent)) continue;
      const newId = randomUUID();
      const { error } = await supabase.from("folders").insert({
        id: newId,
        user_id: user.id,
        name: f.name as string,
        parent_id: parentInTree ? folderIdMap.get(parent)! : null,
      });
      if (error) return { error: "Não foi possível importar as pastas." };
      folderIdMap.set(f.id as string, newId);
      pending.splice(i, 1);
    }
  }

  // Images: copied once each, into the importer's own prefix.
  const admin = createAdminClient();
  const imageMap = new Map<string, string>();
  let copied = 0;
  // Only images whose owner is actually linked to the importer by a share —
  // the same rule the image route applies when serving them.
  const connected = new Map<string, boolean>();
  async function mayCopy(path: string) {
    const prefixOwner = path.split("/")[0] ?? "";
    if (!connected.has(prefixOwner)) {
      const { data } = await supabase.rpc("shares_connect", { p_other: prefixOwner });
      connected.set(prefixOwner, data === true);
    }
    return connected.get(prefixOwner) === true;
  }
  async function copyImage(path: string): Promise<string | undefined> {
    if (imageMap.has(path)) return imageMap.get(path);
    if (copied >= MAX_IMPORT_IMAGES || !(await mayCopy(path))) return undefined;
    copied++;
    const ext = path.split(".").pop()?.toLowerCase() ?? "png";
    const { data: blob } = await admin.storage.from(NOTE_IMAGES_BUCKET).download(path);
    if (!blob) return undefined;
    const target = `${user!.id}/${randomUUID()}.${ext}`;
    const { error } = await admin.storage.from(NOTE_IMAGES_BUCKET).upload(target, blob, {
      contentType: blob.type || undefined,
      upsert: false,
    });
    if (error) return undefined;
    imageMap.set(path, target);
    return target;
  }

  let imported = 0;
  for (const n of notes ?? []) {
    let body = decryptText(n.body as string) ?? "";
    for (const path of extractNoteImagePaths(body)) {
      const copy = await copyImage(path);
      if (copy) body = body.split(noteImageUrl(path)).join(noteImageUrl(copy));
    }
    const newId = randomUUID();
    const folderId = n.folder_id ? folderIdMap.get(n.folder_id as string) ?? null : null;
    const { error } = await supabase.from("notes").insert({
      id: newId,
      user_id: user.id,
      title: encryptText(decryptText(n.title as string) ?? ""),
      body: encryptText(body),
      folder_id: folderId,
      type: "nota",
    });
    if (error) continue;
    imported++;
    await refreshNoteDerivedData(supabase, user.id, newId, user.id, body);
  }

  return { importedNotes: imported };
}
