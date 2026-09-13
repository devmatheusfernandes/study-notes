"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALLOWED_IMAGE_EXTENSIONS, JWPUB_MEDIA_BUCKET, JWPUB_MEDIA_BATCH_SIZE, MAX_IMAGE_SIZE } from "@/lib/storage-config";

/**
 * A shared, single-copy publication every signed-in user reads (see
 * supabase/migrations/0038_global_publications.sql) instead of each user
 * downloading and storing their own multi-hundred-MB copy — same trust
 * model as app/(app)/research-guide-actions.ts: no ownership check beyond
 * "is signed in", writes only through the service-role client, a full wipe
 * on re-import rather than an upsert (a newer edition can drop entries an
 * older one had).
 */

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function sanitizeFileName(name: string) {
  return name.trim().slice(-120).replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Plain-text extraction for `content_text` (see migration 0039) — ts_headline needs real prose to excerpt, not raw markup, and a generated column can't call an HTML-stripping function inline without lying about its volatility. Same approach as stripHtmlForSnippet in jwpub-actions.ts. */
function stripHtmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export interface GlobalPublicationChapterInput {
  documentId: number;
  mepsDocumentId: number | null;
  position: number;
  title: string;
  contentHtml: string;
}

export interface GlobalPublicationFootnoteInput {
  footnoteId: number;
  contentHtml: string;
}

export interface GlobalPublicationStats {
  title: string | null;
  chapterCount: number;
  importedAt: string | null;
  sourceHash: string | null;
}

export async function getGlobalPublicationStats(symbol: string): Promise<GlobalPublicationStats> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { title: null, chapterCount: 0, importedAt: null, sourceHash: null };

  const { data: pub } = await supabase
    .from("global_publications")
    .select("title")
    .eq("symbol", symbol)
    .maybeSingle();
  const { data: meta } = await supabase
    .from("global_publications_meta")
    .select("chapter_count, imported_at, source_hash")
    .eq("symbol", symbol)
    .maybeSingle();

  return {
    title: pub?.title ?? null,
    chapterCount: meta?.chapter_count ?? 0,
    importedAt: meta?.imported_at ?? null,
    sourceHash: meta?.source_hash ?? null,
  };
}

/** Same skip-if-already-imported check as checkResearchGuideNeedsImport — see that function's own comment for why both the hash AND the import version have to match. */
export async function checkGlobalPublicationNeedsImport(
  symbol: string,
  sourceHash: string,
  importVersion: number
): Promise<{ needsImport: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { needsImport: true, error: "Sessão expirada." };

  const { data } = await supabase
    .from("global_publications_meta")
    .select("source_hash, imported_at, import_version")
    .eq("symbol", symbol)
    .maybeSingle();

  const alreadyImported =
    data?.imported_at != null && data?.source_hash === sourceHash && data?.import_version === importVersion;
  return { needsImport: !alreadyImported };
}

export async function beginGlobalPublicationImport(
  symbol: string,
  title: string,
  mepsLanguageIndex: number | null,
  sourceHash: string,
  importVersion: number
): Promise<{ ok: boolean; publicationId?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  try {
    const admin = createAdminClient();

    // Full wipe, same reasoning as beginResearchGuideImport: a newer edition
    // can drop entries the old one had, so an upsert-in-place would leave
    // those stale rows behind forever. Chapters/footnotes cascade away with
    // the publication row.
    await admin.from("global_publications").delete().eq("symbol", symbol);

    const { data: pub, error: pubError } = await admin
      .from("global_publications")
      .insert({ symbol, title, meps_language_index: mepsLanguageIndex })
      .select("id")
      .single();
    if (pubError || !pub) return { ok: false, error: "Não foi possível registrar a publicação." };

    const { error: metaError } = await admin.from("global_publications_meta").upsert(
      {
        symbol,
        source_hash: sourceHash,
        import_version: importVersion,
        chapter_count: 0,
        imported_at: null,
      },
      { onConflict: "symbol" }
    );
    if (metaError) return { ok: false, error: "Não foi possível reiniciar o progresso." };

    return { ok: true, publicationId: pub.id };
  } catch (error) {
    console.error("Erro ao iniciar importação de publicação global:", error);
    return { ok: false, error: "Não foi possível iniciar a importação." };
  }
}

export async function appendGlobalPublicationChapters(
  symbol: string,
  publicationId: string,
  chapters: GlobalPublicationChapterInput[]
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (chapters.length === 0) return { ok: true };

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("global_publication_chapters").insert(
      chapters.map((c) => ({
        publication_id: publicationId,
        document_id: c.documentId,
        meps_document_id: c.mepsDocumentId,
        position: c.position,
        title: c.title,
        content_html: c.contentHtml,
        content_text: stripHtmlToText(c.contentHtml),
      }))
    );
    if (error) return { ok: false, error: "Não foi possível gravar este lote." };

    const { data: current } = await admin
      .from("global_publications_meta")
      .select("chapter_count")
      .eq("symbol", symbol)
      .single();
    await admin
      .from("global_publications_meta")
      .update({ chapter_count: (current?.chapter_count ?? 0) + chapters.length })
      .eq("symbol", symbol);

    return { ok: true };
  } catch (error) {
    console.error("Erro ao gravar lote de capítulos de publicação global:", error);
    return { ok: false, error: "Não foi possível gravar este lote." };
  }
}

export async function appendGlobalPublicationFootnotes(
  publicationId: string,
  footnotes: GlobalPublicationFootnoteInput[]
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (footnotes.length === 0) return { ok: true };

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("global_publication_footnotes").upsert(
      footnotes.map((f) => ({
        publication_id: publicationId,
        footnote_id: f.footnoteId,
        content_html: f.contentHtml,
      })),
      { onConflict: "publication_id,footnote_id" }
    );
    if (error) return { ok: false, error: "Não foi possível gravar as notas de rodapé." };
    return { ok: true };
  } catch (error) {
    console.error("Erro ao gravar notas de rodapé de publicação global:", error);
    return { ok: false, error: "Não foi possível gravar as notas de rodapé." };
  }
}

export async function finishGlobalPublicationImport(symbol: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("global_publications_meta")
    .update({ imported_at: new Date().toISOString() })
    .eq("symbol", symbol);
  if (error) return { ok: false, error: "Não foi possível concluir a importação." };
  return { ok: true };
}

export interface GlobalPublicationSymbolSummary {
  symbol: string;
  title: string;
}

/**
 * Every fully-imported global publication, as `symbol → title` — merged into
 * the note editor's own `listPublicationSymbols` (jwpub-actions.ts) list so
 * the "@" menu and the "(symbol N)" shortcut recognise a shared publication
 * like Perspicaz even though the caller never uploaded it themselves.
 * Filtered to `imported_at is not null` so a publication mid-import (rows
 * inserted, chapters not yet appended) doesn't show up as a dead end.
 */
export async function listGlobalPublicationSymbols(): Promise<{ publications: GlobalPublicationSymbolSummary[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { publications: [] };

  // No foreign key links global_publications to global_publications_meta
  // (meta's `symbol` is its own primary key, not a references clause), so
  // PostgREST can't embed one in the other — two queries, joined here.
  const [{ data: pubs }, { data: meta }] = await Promise.all([
    supabase.from("global_publications").select("symbol, title"),
    supabase.from("global_publications_meta").select("symbol").not("imported_at", "is", null),
  ]);

  const importedSymbols = new Set((meta ?? []).map((row) => row.symbol));
  const publications: GlobalPublicationSymbolSummary[] = [];
  for (const row of pubs ?? []) {
    if (!row.symbol || !importedSymbols.has(row.symbol)) continue;
    publications.push({ symbol: row.symbol.toLowerCase(), title: row.title });
  }
  return { publications };
}

/** Fetches one article's full HTML — used when a Bible-page search result (see searchInsightChapters in bible-search-actions.ts) is expanded, since the search RPC itself only returns a headline excerpt, not the whole article. */
export async function getGlobalPublicationChapterContent(
  publicationId: string,
  documentId: number
): Promise<{ html?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data } = await supabase
    .from("global_publication_chapters")
    .select("content_html")
    .eq("publication_id", publicationId)
    .eq("document_id", documentId)
    .maybeSingle();

  if (!data) return { error: "Artigo não encontrado." };
  return { html: data.content_html ?? "" };
}

/**
 * Same shape as uploadPublicationMedia in jwpub-actions.ts, but there's no
 * per-user ownership to check — anyone signed in can (re)import this shared
 * content, same trust level as the rest of this table's writes. Storage path
 * is `global/${symbol}/…` instead of `${user_id}/${publicationId}/…`.
 */
export async function uploadGlobalPublicationMedia(
  formData: FormData
): Promise<{ urls?: Record<string, string>; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const symbol = formData.get("symbol");
  if (typeof symbol !== "string" || !symbol.trim()) return { error: "Publicação inválida." };

  const incoming = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (incoming.length === 0) return { urls: {} };
  if (incoming.length > JWPUB_MEDIA_BATCH_SIZE) return { error: "Lote de imagens grande demais." };

  const admin = createAdminClient();
  const urls: Record<string, string> = {};

  for (const file of incoming) {
    const ext = extensionOf(file.name);
    const contentType = ALLOWED_IMAGE_EXTENSIONS[ext] ?? (ext === "svg" ? "image/svg+xml" : null);
    if (!contentType || file.size > MAX_IMAGE_SIZE) continue;

    const bytes = new Blob([await file.arrayBuffer()], { type: contentType });
    const storagePath = `global/${symbol}/${sanitizeFileName(file.name)}`;
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
