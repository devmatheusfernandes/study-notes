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
  sectionNumber: number | null;
  docClass: number | null;
  contentHtml: string;
}

/** One embedded excerpt behind a `data-jwpub-extract` citation, already rewritten and sanitized by the importer. Mirrors JwpubExtractRow in jwpub-actions.ts. */
export interface GlobalPublicationExtract {
  extractId: number;
  html: string;
  caption: string | null;
  refTitle: string | null;
  refSymbol: string | null;
  refMepsDocumentId: number | null;
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
        section_number: c.sectionNumber,
        doc_class: c.docClass,
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

export async function appendGlobalPublicationExtracts(
  publicationId: string,
  extracts: GlobalPublicationExtract[]
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (extracts.length === 0) return { ok: true };

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("global_publication_extracts").upsert(
      extracts.map((e) => ({
        publication_id: publicationId,
        extract_id: e.extractId,
        content_html: e.html,
        caption: e.caption,
        ref_title: e.refTitle,
        ref_symbol: e.refSymbol,
        ref_meps_document_id: e.refMepsDocumentId,
      })),
      { onConflict: "publication_id,extract_id" }
    );
    if (error) return { ok: false, error: "Não foi possível gravar os trechos citados." };
    return { ok: true };
  } catch (error) {
    console.error("Erro ao gravar trechos de publicação global:", error);
    return { ok: false, error: "Não foi possível gravar os trechos citados." };
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

export interface GlobalPublicationIndexEntry {
  documentId: number;
  title: string;
  sectionNumber: number | null;
  docClass: number | null;
}

export interface GlobalPublicationIndex {
  publicationId: string;
  title: string;
  entries: GlobalPublicationIndexEntry[];
}

/**
 * Article list of one fully-imported global publication — titles only, no
 * content, so the Bible page's Perspicaz / Guia de Pesquisa index stays cheap
 * (Perspicaz alone is ~5.000 articles). Returns nothing for a publication
 * that isn't imported, or is mid-import.
 */
export async function getGlobalPublicationIndex(
  symbol: string
): Promise<{ index?: GlobalPublicationIndex; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const [{ data: pub }, { data: meta }] = await Promise.all([
    supabase.from("global_publications").select("id, title").eq("symbol", symbol).maybeSingle(),
    supabase.from("global_publications_meta").select("imported_at").eq("symbol", symbol).maybeSingle(),
  ]);
  if (!pub || !meta?.imported_at) return { error: "Publicação ainda não importada." };

  // PostgREST caps a single response (1.000 rows by default), and Perspicaz
  // has several thousand articles — paged until a short page comes back.
  const PAGE = 1000;
  const entries: GlobalPublicationIndexEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("global_publication_chapters")
      .select("document_id, title, section_number, doc_class")
      .eq("publication_id", pub.id)
      .order("position", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { error: "Não foi possível carregar o índice." };
    for (const row of data ?? []) {
      entries.push({
        documentId: row.document_id,
        title: row.title,
        sectionNumber: row.section_number,
        docClass: row.doc_class,
      });
    }
    if (!data || data.length < PAGE) break;
  }

  return { index: { publicationId: pub.id, title: pub.title, entries } };
}

/** The excerpts behind one `data-jwpub-extract` citation, in the order the citation names them. */
export async function getGlobalPublicationExtracts(
  publicationId: string,
  extractIds: number[]
): Promise<{ extracts?: GlobalPublicationExtract[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };
  const ids = extractIds.filter((id) => Number.isFinite(id));
  if (ids.length === 0) return { extracts: [] };

  const { data, error } = await supabase
    .from("global_publication_extracts")
    .select("extract_id, content_html, caption, ref_title, ref_symbol, ref_meps_document_id")
    .eq("publication_id", publicationId)
    .in("extract_id", ids);
  if (error) return { error: "Não foi possível carregar o trecho citado." };

  const byId = new Map(
    (data ?? []).map((row) => [
      row.extract_id,
      {
        extractId: row.extract_id,
        html: row.content_html,
        caption: row.caption,
        refTitle: row.ref_title,
        refSymbol: row.ref_symbol,
        refMepsDocumentId: row.ref_meps_document_id,
      } satisfies GlobalPublicationExtract,
    ])
  );
  return { extracts: ids.map((id) => byId.get(id)).filter((row): row is GlobalPublicationExtract => row !== undefined) };
}

export async function getGlobalPublicationFootnote(
  publicationId: string,
  footnoteId: number
): Promise<{ html?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data } = await supabase
    .from("global_publication_footnotes")
    .select("content_html")
    .eq("publication_id", publicationId)
    .eq("footnote_id", footnoteId)
    .maybeSingle();
  if (!data) return { error: "Nota de rodapé não encontrada." };
  return { html: data.content_html };
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
