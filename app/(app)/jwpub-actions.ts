"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateNoteRow } from "@/app/(app)/notes-actions";
import { encryptText, decryptText } from "@/lib/encryption";
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
  chapters: { documentId: number; mepsDocumentId: number | null; position: number; title: string }[];
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

  // The note row was created with the raw filename as its title (before
  // parsing knew any better) — swap in the publication's real title now that
  // we have it. Best-effort: a failure here shouldn't fail the whole ingest,
  // it just leaves the filename as the title.
  if (input.title.trim() !== "") {
    await updateNoteRow(input.noteId, { title: input.title }).catch(() => {});
  }

  if (input.chapters.length > 0) {
    const { error: chaptersError } = await supabase.from("jwpub_chapters").insert(
      input.chapters.map((chapter) => ({
        user_id: user.id,
        publication_id: publication.id,
        document_id: chapter.documentId,
        meps_document_id: chapter.mepsDocumentId,
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
    .select("id, symbol, title, status, meps_language_index, issue_tag_number")
    .eq("note_id", noteId)
    .maybeSingle();

  if (!publication) return {};

  const { data: chapters } = await supabase
    .from("jwpub_chapters")
    .select("document_id, meps_document_id, position, title, content_html")
    .eq("publication_id", publication.id)
    .order("position", { ascending: true });

  return {
    publication: {
      id: publication.id,
      symbol: publication.symbol,
      title: publication.title,
      status: publication.status as PublicationSummary["status"],
      mepsLanguageIndex: publication.meps_language_index,
      issueTagNumber: publication.issue_tag_number,
    },
    chapters: (chapters ?? []).map((chapter) => ({
      documentId: chapter.document_id,
      mepsDocumentId: chapter.meps_document_id,
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

export interface ResolvedJwpubReference {
  mepsDocumentId: number;
  noteId: string;
  publicationId: string;
  publicationTitle: string;
  documentId: number;
  chapterTitle: string;
}

/**
 * Batch-resolves `jwpub://p/T:<mepsDocumentId>/…` cross-references (see
 * rewriteJwpubLinks in lib/jwpub/sanitize.ts) against the caller's own
 * already-ingested publications — deliberately dynamic, not done once at
 * ingest time, since a reference that's inert today becomes clickable the
 * moment the user uploads the publication it points to (and vice versa if
 * they later delete it).
 */
export async function resolveJwpubReferences(
  mepsDocumentIds: number[]
): Promise<{ resolved: ResolvedJwpubReference[] }> {
  const { supabase, user } = await requireUser();
  if (!user || mepsDocumentIds.length === 0) return { resolved: [] };

  const uniqueIds = [...new Set(mepsDocumentIds)];
  const { data } = await supabase
    .from("jwpub_chapters")
    .select("meps_document_id, document_id, title, publication_id, jwpub_publications(note_id, title, status)")
    .in("meps_document_id", uniqueIds);

  const resolved: ResolvedJwpubReference[] = [];
  for (const row of data ?? []) {
    if (row.meps_document_id === null) continue;
    const pub = Array.isArray(row.jwpub_publications) ? row.jwpub_publications[0] : row.jwpub_publications;
    if (!pub || pub.status !== "ready") continue;
    resolved.push({
      mepsDocumentId: row.meps_document_id,
      noteId: pub.note_id,
      publicationId: row.publication_id,
      publicationTitle: pub.title,
      documentId: row.document_id,
      chapterTitle: row.title,
    });
  }
  return { resolved };
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

/**
 * All saved "Your answer" fields for a publication, keyed `"<documentId>:<pid>"` —
 * a field's own `id`/`name` attributes repeat across documents (verified
 * against a real archive), so `data-pid` scoped to its document is the only
 * stable key. Fetched once per publication (not per chapter) since it's cheap
 * and every chapter switch would otherwise re-fetch.
 *
 * Merges two sources, live, every call — so it's correct regardless of import
 * order (a .jwpub processed before or after a .jwlibrary backup that answers
 * one of its fields both end up showing the text):
 *  - `jwpub_answers`: typed directly into this app's own reader.
 *  - `jwlibrary_input_fields`: imported from a `.jwlibrary` backup, matched
 *    to this publication's chapters by Location (KeySymbol/MepsLanguage/
 *    IssueTagNumber/MepsDocumentId — see lib/jwlibrary/resolve.ts for the
 *    same matching convention used on note/highlight import).
 * `jwpub_answers` wins on a key both have — it's the value the user
 * currently sees and last touched in this app; InputField carries no
 * modification timestamp to compare against (see data/jwlibrary_schema.md),
 * so this app's own edit is treated as authoritative rather than guessing.
 */
export async function getAnswers(
  publicationId: string
): Promise<{ answers?: Record<string, string>; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const [{ data: answerRows, error }, { data: publication }, { data: chapters }] = await Promise.all([
    supabase.from("jwpub_answers").select("document_id, pid, answer").eq("publication_id", publicationId),
    supabase
      .from("jwpub_publications")
      .select("symbol, meps_language_index, issue_tag_number")
      .eq("id", publicationId)
      .single(),
    supabase
      .from("jwpub_chapters")
      .select("document_id, meps_document_id")
      .eq("publication_id", publicationId)
      .not("meps_document_id", "is", null),
  ]);
  if (error) return { error: "Não foi possível carregar as respostas." };

  const answers: Record<string, string> = {};

  if (publication && chapters && chapters.length > 0) {
    const documentIdByMepsId = new Map(chapters.map((c) => [c.meps_document_id as number, c.document_id as number]));
    let importedFieldsQuery = supabase
      .from("jwlibrary_input_fields")
      .select("text_tag, value, meps_document_id")
      .eq("key_symbol", publication.symbol)
      .in("meps_document_id", [...documentIdByMepsId.keys()]);
    importedFieldsQuery =
      publication.meps_language_index === null
        ? importedFieldsQuery.is("meps_language", null)
        : importedFieldsQuery.eq("meps_language", publication.meps_language_index);
    importedFieldsQuery =
      publication.issue_tag_number === null
        ? importedFieldsQuery.is("issue_tag_number", null)
        : importedFieldsQuery.eq("issue_tag_number", publication.issue_tag_number);

    const { data: importedFields } = await importedFieldsQuery;

    for (const row of importedFields ?? []) {
      const documentId = row.meps_document_id !== null ? documentIdByMepsId.get(row.meps_document_id) : undefined;
      if (documentId === undefined) continue;
      answers[`${documentId}:${row.text_tag}`] = row.value ?? "";
    }
  }

  // jwpub_answers last, so it overwrites any imported value on the same key.
  for (const row of answerRows ?? []) {
    answers[`${row.document_id}:${row.pid}`] = decryptText(row.answer) ?? "";
  }

  return { answers };
}

/** Upserts one "Your answer" field's text, debounced/triggered client-side — see jwpub-chapter-view.tsx. */
export async function saveAnswer(
  publicationId: string,
  documentId: number,
  pid: string,
  answer: string
): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  if (!(await ownedPublication(supabase, publicationId))) return { error: "Acesso negado." };

  const { error } = await supabase.from("jwpub_answers").upsert(
    {
      user_id: user.id,
      publication_id: publicationId,
      document_id: documentId,
      pid,
      answer: encryptText(answer),
    },
    { onConflict: "publication_id,document_id,pid" }
  );

  return error ? { error: "Não foi possível salvar a resposta." } : {};
}

/* ------------------------------------------------------------------ *
 * In-note references (see lib/notes/note-reference.ts)
 * ------------------------------------------------------------------ */

export interface PublicationSymbolSummary {
  symbol: string;
  title: string;
  noteId: string;
  publicationId: string;
}

/**
 * Every publication this user has ingested, as `symbol → title`.
 *
 * The note editor loads this once on mount and uses it to decide whether a
 * typed "(th 2)" is a real reference at all — without that check, ordinary
 * parenthetical prose would be marked up as a reference that can never
 * resolve. Deliberately excludes `status = 'failed'` rows, which have no
 * chapters to open.
 */
export async function listPublicationSymbols(): Promise<{
  publications: PublicationSymbolSummary[];
}> {
  const { supabase, user } = await requireUser();
  if (!user) return { publications: [] };

  const { data } = await supabase
    .from("jwpub_publications")
    .select("id, note_id, symbol, title")
    .eq("status", "ready")
    .order("title", { ascending: true });

  const publications: PublicationSymbolSummary[] = [];
  for (const row of data ?? []) {
    if (!row.symbol) continue;
    publications.push({
      symbol: row.symbol.toLowerCase(),
      title: row.title,
      noteId: row.note_id,
      publicationId: row.id,
    });
  }
  return { publications };
}

/**
 * Matches a chapter title against the number the user wrote in "(th 2)".
 *
 * Publications number their parts inconsistently — "Estudo 2", "Lição 2",
 * "2 Seja um bom leitor" — so this tries the labelled forms first and only
 * then a bare leading number, mirroring the heuristic JwpubReader already
 * uses for `?chapter=` links.
 */
function chapterTitleMatchesNumber(title: string, wanted: number): boolean {
  const normalized = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Built from a plain string, not a template literal: the escapes here are
  // regex syntax, and a template literal would consume them as string escapes
  // first (turning "\\s" into a literal "s").
  const labelled = new RegExp(
    "(?:licao|capitulo|cap\\.?|estudo|secao|parte|artigo)\\s*0*" + wanted + "(?!\\d)"
  );
  if (labelled.test(normalized)) return true;

  const leading = /^\s*0*(\d{1,3})(?!\d)/.exec(normalized);
  return leading !== null && Number(leading[1]) === wanted;
}

export interface ResolvedPublicationReference {
  noteId: string;
  publicationId: string;
  publicationTitle: string;
  symbol: string;
  documentId: number;
  chapterTitle: string;
  html: string;
}

/**
 * Opens "(th 2)" — the caller's own `th` publication, chapter 2 — in one
 * round trip: finds the publication by symbol, picks the chapter, and returns
 * its content.
 *
 * Resolved at click time rather than when the reference was typed, so a
 * reference written before the publication was uploaded starts working the
 * moment it lands (and stops if the file is deleted) — the same reasoning as
 * resolveJwpubReferences above.
 */
export async function resolvePublicationReference(
  symbol: string,
  chapter: number | null
): Promise<{ reference?: ResolvedPublicationReference; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const cleanSymbol = symbol.trim().toLowerCase();
  if (!cleanSymbol) return { error: "Referência inválida." };

  const { data: publication } = await supabase
    .from("jwpub_publications")
    .select("id, note_id, title, symbol")
    .ilike("symbol", cleanSymbol)
    .eq("status", "ready")
    .limit(1)
    .maybeSingle();

  if (!publication) {
    return { error: `Você ainda não tem a publicação "${cleanSymbol.toUpperCase()}" na sua biblioteca.` };
  }

  const { data: chapters } = await supabase
    .from("jwpub_chapters")
    .select("document_id, position, title, content_html")
    .eq("publication_id", publication.id)
    .order("position", { ascending: true });

  if (!chapters || chapters.length === 0) return { error: "Publicação sem capítulos." };

  let match = chapters[0];
  if (chapter !== null) {
    const byTitle = chapters.find((row) => chapterTitleMatchesNumber(row.title, chapter));
    // Position is 0-based, so "chapter 2" is index 2 only when the file has a
    // cover/front-matter document at 0 — try both rather than guessing.
    const byPosition =
      chapters.find((row) => row.position === chapter) ??
      chapters.find((row) => row.position === chapter - 1);
    const resolved = byTitle ?? byPosition;
    if (!resolved) {
      return { error: `A publicação "${publication.title}" não tem um capítulo ${chapter}.` };
    }
    match = resolved;
  }

  return {
    reference: {
      noteId: publication.note_id,
      publicationId: publication.id,
      publicationTitle: publication.title,
      symbol: publication.symbol,
      documentId: match.document_id,
      chapterTitle: match.title,
      html: match.content_html ?? "",
    },
  };
}
