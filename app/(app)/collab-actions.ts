"use server";

import * as Y from "yjs";
import { createClient } from "@/lib/supabase/server";
import { encryptText, decryptText } from "@/lib/encryption";
import { refreshNoteDerivedData } from "@/lib/notes/derived-data";

/*
 * Persistence for collaboratively edited notes (0055: note_collab_state).
 *
 * The Yjs document is the source of truth for a shared note's text; notes.body
 * is a derived HTML snapshot written alongside it, so card previews, search,
 * vectorization and the scripture index keep working unchanged. The state is
 * encrypted at rest with the same key as note text. Saves MERGE into what's
 * stored (Y.mergeUpdates) instead of replacing it — an editor coming back
 * from offline can never wipe out what others wrote meanwhile — and use the
 * row's updated_at as an optimistic lock so two concurrent saves can't drop
 * each other's merge either.
 */

export type CollabRole = "owner" | "editor" | "viewer";

export interface CollabOpenResult {
  role: CollabRole | null;
  /** True when the note is shared (pending or accepted) — or the caller isn't its owner. */
  collaborative: boolean;
  /** base64 Yjs update, or null when no collaborative state exists yet. */
  state: string | null;
  title?: string;
  body?: string;
  error?: string;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function roleFor(supabase: Supabase, noteId: string): Promise<CollabRole | null> {
  const { data, error } = await supabase.rpc("note_share_role", { p_note_id: noteId });
  if (error) return null;
  return (data as CollabRole | null) ?? null;
}

/** Whether any share (pending or accepted) covers this owner's note — directly or through a folder above it. */
async function isSharedByOwner(supabase: Supabase, userId: string, noteId: string): Promise<boolean> {
  const { data: note } = await supabase.from("notes").select("folder_id, type").eq("id", noteId).eq("user_id", userId).maybeSingle();
  if (!note || note.type !== "nota") return false;

  const { data: shares } = await supabase
    .from("shares")
    .select("note_id, folder_id")
    .eq("owner_id", userId)
    .in("status", ["pending", "accepted"]);
  if (!shares?.length) return false;
  if (shares.some((s) => s.note_id === noteId)) return true;

  const sharedFolders = new Set(shares.map((s) => s.folder_id).filter(Boolean) as string[]);
  if (sharedFolders.size === 0 || !note.folder_id) return false;
  const { data: folders } = await supabase.from("folders").select("id, parent_id").eq("user_id", userId);
  const parentOf = new Map((folders ?? []).map((f) => [f.id as string, f.parent_id as string | null]));
  const seen = new Set<string>();
  let cursor: string | null = note.folder_id as string;
  while (cursor && !seen.has(cursor)) {
    if (sharedFolders.has(cursor)) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

function decodeState(encrypted: string | null | undefined): Uint8Array | null {
  const b64 = decryptText(encrypted ?? null);
  if (!b64 || b64.startsWith("[")) return null; // decryptText's error markers
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function encodeState(update: Uint8Array): string {
  return encryptText(Buffer.from(update).toString("base64"));
}

function parseUpdate(b64: unknown): Uint8Array | null {
  if (typeof b64 !== "string" || b64.length === 0 || b64.length > 8_000_000) return null;
  try {
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    // Throws on garbage — never store something Yjs can't read back.
    Y.applyUpdate(new Y.Doc(), bytes);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Everything the editor needs to open a note in collaborative mode, in one
 * round trip. `collaborative: false` means "edit it the normal way" (an
 * unshared note of the caller's own) — nothing else is loaded then.
 */
export async function openCollabNote(noteId: string): Promise<CollabOpenResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { role: null, collaborative: false, state: null, error: "Sessão expirada." };

  const role = await roleFor(supabase, noteId);
  if (!role) return { role: null, collaborative: false, state: null, error: "Sem acesso a esta nota." };
  if (role === "owner" && !(await isSharedByOwner(supabase, user.id, noteId))) {
    return { role, collaborative: false, state: null };
  }

  const [{ data: row }, { data: note }] = await Promise.all([
    supabase.from("note_collab_state").select("state").eq("note_id", noteId).maybeSingle(),
    supabase.from("notes").select("title, body").eq("id", noteId).maybeSingle(),
  ]);
  const state = decodeState(row?.state as string | undefined);
  return {
    role,
    collaborative: true,
    state: state ? Buffer.from(state).toString("base64") : null,
    title: decryptText(note?.title as string | undefined) ?? "",
    body: decryptText(note?.body as string | undefined) ?? "",
  };
}

/** Cheap access re-check for an open shared note (polled while it's open). */
export async function checkNoteAccess(noteId: string): Promise<{ role: CollabRole | null }> {
  const { supabase, user } = await requireUser();
  if (!user) return { role: null };
  return { role: await roleFor(supabase, noteId) };
}

/**
 * First client to open a newly shared note seeds its Yjs state from the HTML.
 * Two clients doing that at once would each build their own copy of the text
 * and merging those would DUPLICATE it — so the insert only succeeds once,
 * and everyone (the winner included) continues from whatever got stored.
 */
export async function initCollabState(noteId: string, seed: string): Promise<{ state?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  const role = await roleFor(supabase, noteId);
  if (role !== "owner" && role !== "editor") return { error: "Sem permissão para editar." };
  const update = parseUpdate(seed);
  if (!update) return { error: "Estado inválido." };

  await supabase
    .from("note_collab_state")
    .upsert({ note_id: noteId, state: encodeState(update) }, { onConflict: "note_id", ignoreDuplicates: true });

  const { data: row } = await supabase.from("note_collab_state").select("state").eq("note_id", noteId).maybeSingle();
  const stored = decodeState(row?.state as string | undefined);
  if (!stored) return { error: "Não foi possível iniciar a colaboração." };
  return { state: Buffer.from(stored).toString("base64") };
}

const MAX_SAVE_ATTEMPTS = 4;

/**
 * Merges this client's document into the stored one and refreshes the note's
 * HTML/title snapshot. `html` is the client's rendering of its own merged doc —
 * a derived snapshot, last write wins, which is fine because the next save of
 * any participant rewrites it from a doc that contains everyone's edits.
 */
export async function saveCollabState(
  noteId: string,
  update: string,
  html: string,
  title: string
): Promise<{ error?: string; transient?: boolean }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada.", transient: true };
  const role = await roleFor(supabase, noteId);
  if (role !== "owner" && role !== "editor") return { error: "Sem permissão para editar." };
  const incoming = parseUpdate(update);
  if (!incoming) return { error: "Estado inválido." };
  if (typeof html !== "string" || typeof title !== "string") return { error: "Dados inválidos." };

  let saved = false;
  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS && !saved; attempt++) {
    const { data: row } = await supabase
      .from("note_collab_state")
      .select("state, updated_at")
      .eq("note_id", noteId)
      .maybeSingle();

    if (!row) {
      const { error } = await supabase.from("note_collab_state").insert({ note_id: noteId, state: encodeState(incoming) });
      saved = !error;
      continue;
    }

    const current = decodeState(row.state as string);
    const merged = current ? Y.mergeUpdates([current, incoming]) : incoming;
    const { data: updated } = await supabase
      .from("note_collab_state")
      .update({ state: encodeState(merged), updated_at: new Date().toISOString() })
      .eq("note_id", noteId)
      .eq("updated_at", row.updated_at as string)
      .select("note_id");
    saved = (updated?.length ?? 0) > 0;
  }
  if (!saved) return { error: "Conflito ao salvar. Tentando de novo…", transient: true };

  const { data: note, error } = await supabase
    .from("notes")
    .update({ title: encryptText(title.trim() || "Nova nota"), body: encryptText(html) })
    .eq("id", noteId)
    .select("user_id")
    .maybeSingle();
  if (error || !note) return { error: "Não foi possível salvar." };
  await refreshNoteDerivedData(supabase, user.id, noteId, note.user_id as string, html);
  return {};
}
