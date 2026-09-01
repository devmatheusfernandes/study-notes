"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  JWPUB_MEDIA_BUCKET,
  JWPUB_MEDIA_BATCH_SIZE,
  MAX_IMAGE_SIZE,
} from "@/lib/storage-config";
import type { ChapterSummary, PublicationSummary } from "@/lib/jwpub/types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Confirms the caller owns the publication and hands back its id. Reading the
 * row through the per-request (RLS-scoped) client IS the ownership check —
 * a row belonging to someone else simply isn't visible.
 */
async function ownedPublication(
  supabase: Awaited<ReturnType<typeof createClient>>,
  publicationId: string
) {
  const { data } = await supabase
    .from("jwpub_publications")
    .select("id")
    .eq("id", publicationId)
    .single();
  return data?.id ?? null;
}

export interface SavePublicationInput {
  noteId: string;
  symbol: string;
  title: string;
  mepsLanguageIndex: number | null;
  year: number | null;
  issueTagNumber: number | null;
  chapters: { documentId: number; position: number; title: string }[];
}

/** Creates (or replaces) the publication row plus one stub per chapter. */
export async function savePublication(
  input: SavePublicationInput
): Promise<{ publicationId?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  // RLS makes this select the ownership check for the note itself.
  const { data: note } = await supabase
    .from("notes")
    .select("id")
    .eq("id", input.noteId)
    .single();
  if (!note) return { error: "Publicação não encontrada." };

  // Re-ingesting replaces whatever was there: chapters/footnotes cascade away.
  await supabase.from("jwpub_publications").delete().eq("note_id", input.noteId);

  const { data: publication, error } = await supabase
    .from("jwpub_publications")
    .insert({
      user_id: user.id,
      note_id: input.noteId,
      symbol: input.symbol,
      title: input.title,
      meps_language_index: input.mepsLanguageIndex,
      year: input.year,
      issue_tag_number: input.issueTagNumber,
      status: "ready",
    })
    .select("id")
    .single();

  if (error || !publication) return { error: "Não foi possível registrar a publicação." };

  if (input.chapters.length > 0) {
    const { error: chaptersError } = await supabase.from("jwpub_chapters").insert(
      input.chapters.map((chapter) => ({
        user_id: user.id,
        publication_id: publication.id,
        document_id: chapter.documentId,
        position: chapter.position,
        title: chapter.title,
      }))
    );
    if (chaptersError) return { error: "Não foi possível registrar os capítulos." };
  }

  return { publicationId: publication.id };
}

/** One call per chapter — a whole publication's HTML in a single action would be a huge payload. */
export async function saveChapterContent(
  publicationId: string,
  documentId: number,
  html: string
): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  if (!(await ownedPublication(supabase, publicationId))) return { error: "Acesso negado." };

  const { error } = await supabase
    .from("jwpub_chapters")
    .update({ content_html: html })
    .eq("publication_id", publicationId)
    .eq("document_id", documentId);

  return error ? { error: "Não foi possível salvar o capítulo." } : {};
}

export async function saveFootnotes(
  publicationId: string,
  footnotes: { footnoteId: number; html: string }[]
): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  if (!(await ownedPublication(supabase, publicationId))) return { error: "Acesso negado." };
  if (footnotes.length === 0) return {};

  const { error } = await supabase.from("jwpub_footnotes").upsert(
    footnotes.map((footnote) => ({
      user_id: user.id,
      publication_id: publicationId,
      footnote_id: footnote.footnoteId,
      content_html: footnote.html,
    })),
    { onConflict: "publication_id,footnote_id" }
  );

  return error ? { error: "Não foi possível salvar as notas de rodapé." } : {};
}

export async function markPublicationFailed(noteId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  await supabase.from("jwpub_publications").delete().eq("note_id", noteId);
  const { error } = await supabase.from("jwpub_publications").insert({
    user_id: user.id,
    note_id: noteId,
    status: "failed",
  });

  return error ? { error: "Não foi possível registrar a falha." } : {};
}

/** Metadata + chapter list, deliberately without `content_html` so opening the reader stays cheap. */
export async function getPublication(
  noteId: string
): Promise<{ publication?: PublicationSummary; chapters?: ChapterSummary[]; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data: publication } = await supabase
    .from("jwpub_publications")
    .select("id, symbol, title, status")
    .eq("note_id", noteId)
    .maybeSingle();

  if (!publication) return {};

  const { data: chapters } = await supabase
    .from("jwpub_chapters")
    .select("document_id, position, title, content_html")
    .eq("publication_id", publication.id)
    .order("position", { ascending: true });

  return {
    publication: {
      id: publication.id,
      symbol: publication.symbol,
      title: publication.title,
      status: publication.status as PublicationSummary["status"],
    },
    chapters: (chapters ?? []).map((chapter) => ({
      documentId: chapter.document_id,
      position: chapter.position,
      title: chapter.title,
      hasContent: !!chapter.content_html,
    })),
  };
}

export async function getChapter(
  publicationId: string,
  documentId: number
): Promise<{ html?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data } = await supabase
    .from("jwpub_chapters")
    .select("content_html")
    .eq("publication_id", publicationId)
    .eq("document_id", documentId)
    .maybeSingle();

  if (!data) return { error: "Capítulo não encontrado." };
  return { html: data.content_html ?? "" };
}

export async function getFootnote(
  publicationId: string,
  footnoteId: number
): Promise<{ html?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data } = await supabase
    .from("jwpub_footnotes")
    .select("content_html")
    .eq("publication_id", publicationId)
    .eq("footnote_id", footnoteId)
    .maybeSingle();

  if (!data) return { error: "Nota de rodapé não encontrada." };
  return { html: data.content_html };
}

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function sanitizeFileName(name: string) {
  return name.trim().slice(-120).replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Uploads one batch of illustrations for a publication and returns
 * `originalFileName → public URL`.
 *
 * `upsert: true` on a deterministic path makes re-ingesting the same file
 * idempotent instead of piling up duplicates.
 */
export async function uploadPublicationMedia(
  formData: FormData
): Promise<{ urls?: Record<string, string>; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const publicationId = formData.get("publicationId");
  if (typeof publicationId !== "string") return { error: "Publicação inválida." };
  if (!(await ownedPublication(supabase, publicationId))) return { error: "Acesso negado." };

  const incoming = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (incoming.length === 0) return { urls: {} };
  if (incoming.length > JWPUB_MEDIA_BATCH_SIZE) return { error: "Lote de imagens grande demais." };

  const admin = createAdminClient();
  const urls: Record<string, string> = {};

  for (const file of incoming) {
    const ext = extensionOf(file.name);
    const contentType = ALLOWED_IMAGE_EXTENSIONS[ext] ?? (ext === "svg" ? "image/svg+xml" : null);
    if (!contentType || file.size > MAX_IMAGE_SIZE) continue; // skip quietly — one odd asset shouldn't fail the publication

    // Re-wrap with the extension-derived type: images pulled out of a zip
    // arrive typeless (application/octet-stream), which the bucket's
    // allowedMimeTypes check rejects — and per this codebase's convention the
    // browser-supplied MIME is never trusted anyway.
    const bytes = new Blob([await file.arrayBuffer()], { type: contentType });

    const storagePath = `${user.id}/${publicationId}/${sanitizeFileName(file.name)}`;
    const { error } = await admin.storage.from(JWPUB_MEDIA_BUCKET).upload(storagePath, bytes, {
      contentType,
      upsert: true,
    });
    if (error) continue;

    const { data } = admin.storage.from(JWPUB_MEDIA_BUCKET).getPublicUrl(storagePath);
    urls[file.name] = data.publicUrl;
  }

  return { urls };
}

/**
 * Sweeps a publication's whole media prefix. Called when the note is deleted —
 * the Postgres rows go away on their own via `on delete cascade`, but Storage
 * objects need the explicit removal.
 */
export async function deletePublicationMediaForNote(noteId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data: publication } = await supabase
    .from("jwpub_publications")
    .select("id")
    .eq("note_id", noteId)
    .maybeSingle();
  if (!publication) return {};

  const admin = createAdminClient();
  const prefix = `${user.id}/${publication.id}`;
  const { data: objects } = await admin.storage.from(JWPUB_MEDIA_BUCKET).list(prefix, { limit: 1000 });
  if (!objects?.length) return {};

  const { error } = await admin.storage
    .from(JWPUB_MEDIA_BUCKET)
    .remove(objects.map((object) => `${prefix}/${object.name}`));

  return error ? { error: "Não foi possível remover as imagens da publicação." } : {};
}
