"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ResearchGuideEntryInput {
  bookOrder: number;
  chapter: number;
  /** `null` for a Psalm superscription — see splitResearchGuideDocument in lib/bible/research-guide-parse.ts. */
  verse: number | null;
  contentHtml: string;
}

export interface ResearchGuideStats {
  publicationTitle: string | null;
  entryCount: number;
  importedAt: string | null;
  sourceHash: string | null;
}

export async function getResearchGuideStats(): Promise<ResearchGuideStats> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { publicationTitle: null, entryCount: 0, importedAt: null, sourceHash: null };

  const { data } = await supabase
    .from("bible_research_guide_meta")
    .select("publication_title, entry_count, imported_at, source_hash")
    .single();

  return {
    publicationTitle: data?.publication_title ?? null,
    entryCount: data?.entry_count ?? 0,
    importedAt: data?.imported_at ?? null,
    sourceHash: data?.source_hash ?? null,
  };
}

/**
 * Whether an upload actually needs to run the full parse+import — checked
 * against a SHA-256 of the raw file the Settings card hashes *before*
 * spending time decrypting/parsing a 70MB archive, since this table is
 * shared (see CLAUDE.md: no `user_id`, read-only RLS, service-role writes
 * only) and more than one person may end up uploading the very edition
 * that's already imported. Only compares against a *completed* prior import
 * (`imported_at` set) — a hash saved by an import that failed partway
 * through must not block a retry of that same file.
 *
 * Also requires `import_version` to match `RESEARCH_GUIDE_IMPORT_VERSION` —
 * a code change to the parsing/rewriting logic (like the one that added
 * embedded excerpts) doesn't change the source file's hash at all, so
 * without this a reupload of the identical file would be wrongly skipped
 * forever, with no way to pick up the fix short of clearing the row by hand.
 */
export async function checkResearchGuideNeedsImport(
  sourceHash: string,
  importVersion: number
): Promise<{ needsImport: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { needsImport: true, error: "Sessão expirada." };

  const { data } = await supabase
    .from("bible_research_guide_meta")
    .select("source_hash, imported_at, import_version")
    .single();

  const alreadyImported =
    data?.imported_at !== null && data?.source_hash === sourceHash && data?.import_version === importVersion;
  return { needsImport: !alreadyImported };
}

/**
 * Step 1 of a (re)import — wipes the previous edition's rows and resets the
 * progress counter. Called once before the first batch, from the Settings
 * card that just parsed a freshly-uploaded `.jwpub` in the browser.
 *
 * Deliberately a full wipe rather than an upsert-in-place: a newer edition of
 * the guide can drop citations an older one had (an article got pulled), and
 * an upsert would leave those stale rows behind forever.
 */
export async function beginResearchGuideImport(
  publicationTitle: string,
  sourceHash: string,
  importVersion: number
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  try {
    const admin = createAdminClient();
    const { error: deleteError } = await admin.from("bible_research_guide").delete().gte("id", 0);
    if (deleteError) return { ok: false, error: "Não foi possível limpar a edição anterior." };

    const { error: deleteExtractsError } = await admin
      .from("bible_research_guide_extracts")
      .delete()
      .gte("extract_id", 0);
    if (deleteExtractsError) return { ok: false, error: "Não foi possível limpar os trechos da edição anterior." };

    const { error: metaError } = await admin
      .from("bible_research_guide_meta")
      .update({
        publication_title: publicationTitle,
        entry_count: 0,
        imported_at: null,
        source_hash: sourceHash,
        import_version: importVersion,
      })
      .eq("id", true);
    if (metaError) return { ok: false, error: "Não foi possível reiniciar o progresso." };

    return { ok: true };
  } catch (error) {
    console.error("Erro ao iniciar importação do Guia de Pesquisa:", error);
    return { ok: false, error: "Não foi possível iniciar a importação." };
  }
}

/**
 * Step 2, called once per batch the Settings card slices the ~14.800 parsed
 * entries into (a few hundred per call — see the card for the exact size)
 * so no single request carries the whole guide's HTML at once.
 */
export async function appendResearchGuideEntries(
  entries: ResearchGuideEntryInput[]
): Promise<{ ok: boolean; inserted?: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (entries.length === 0) return { ok: true, inserted: 0 };

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("bible_research_guide").insert(
      entries.map((e) => ({
        book_order: e.bookOrder,
        chapter: e.chapter,
        verse: e.verse,
        content_html: e.contentHtml,
      }))
    );
    if (error) return { ok: false, error: "Não foi possível gravar este lote." };

    // Best-effort counter bump — a race between concurrent batches (there
    // shouldn't be any, since the card awaits each call before firing the
    // next) could under-count by a few, which only affects the progress
    // number shown, not the actual imported rows.
    const { data: current } = await admin
      .from("bible_research_guide_meta")
      .select("entry_count")
      .eq("id", true)
      .single();
    await admin
      .from("bible_research_guide_meta")
      .update({ entry_count: (current?.entry_count ?? 0) + entries.length })
      .eq("id", true);

    return { ok: true, inserted: entries.length };
  } catch (error) {
    console.error("Erro ao gravar lote do Guia de Pesquisa:", error);
    return { ok: false, error: "Não foi possível gravar este lote." };
  }
}

export interface ResearchGuideExtractInput {
  extractId: number;
  contentHtml: string;
  refTitle: string | null;
  refSymbol: string | null;
}

/**
 * Companion to appendResearchGuideEntries — the embedded excerpts
 * (`data-jwpub-extract="…"` in an entry's own `content_html`, see
 * lib/jwpub/sanitize.ts) go in their own table since the same excerpt is
 * routinely cited from several verses; `upsert` rather than a plain insert
 * because two different batches of *entries* can each surface the same
 * excerpt for the first time (a story cited from both Gênesis and Provérbios
 * lands in two different entry batches), and re-inserting the identical row
 * is harmless, not an error to guard against.
 */
export async function appendResearchGuideExtracts(
  extracts: ResearchGuideExtractInput[]
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (extracts.length === 0) return { ok: true };

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("bible_research_guide_extracts").upsert(
      extracts.map((e) => ({
        extract_id: e.extractId,
        content_html: e.contentHtml,
        ref_title: e.refTitle,
        ref_symbol: e.refSymbol,
      })),
      { onConflict: "extract_id" }
    );
    if (error) return { ok: false, error: "Não foi possível gravar os trechos deste lote." };
    return { ok: true };
  } catch (error) {
    console.error("Erro ao gravar trechos do Guia de Pesquisa:", error);
    return { ok: false, error: "Não foi possível gravar os trechos deste lote." };
  }
}

export async function finishResearchGuideImport(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("bible_research_guide_meta")
    .update({ imported_at: new Date().toISOString() })
    .eq("id", true);
  if (error) return { ok: false, error: "Não foi possível concluir a importação." };
  return { ok: true };
}

export interface ResearchGuideVerseEntry {
  /** `null` for a Psalm superscription. */
  verse: number | null;
  /** Already-sanitized HTML (see lib/jwpub/sanitize.ts) — a `data-jwpub-extract="…"` link's excerpt is in the sibling `extracts` map below; a `data-jwpub-pubref="…"` one has no embedded text and needs the "Baixar" flow. */
  contentHtml: string;
}

export interface ResearchGuideExtract {
  html: string;
  refTitle: string | null;
  refSymbol: string | null;
}

/**
 * Every citation entry for one chapter, for the study panel's "Guia" tab —
 * same per-chapter fetch shape as getChapterStudyContent in bible-actions.ts.
 * Bundles the referenced excerpts (`extracts`, keyed by the `extractId` each
 * entry's own `data-jwpub-extract` attribute names) in the same round trip
 * rather than a second fetch per citation clicked — a chapter's entries only
 * ever reference a handful of distinct excerpts, cheap to send along.
 */
export async function getChapterResearchGuide(
  bookOrder: number,
  chapter: number
): Promise<{ entries?: ResearchGuideVerseEntry[]; extracts?: Record<number, ResearchGuideExtract>; error?: string }> {
  if (!Number.isFinite(bookOrder) || !Number.isFinite(chapter)) {
    return { error: "Capítulo inválido." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("bible_research_guide")
    .select("verse, content_html")
    .eq("book_order", bookOrder)
    .eq("chapter", chapter)
    // A superscription (null verse) precedes verse 1 — same convention as
    // getChapterCrossReferences in bible-actions.ts.
    .order("verse", { ascending: true, nullsFirst: true });

  if (error) return { error: "Não foi possível carregar o Guia de Pesquisa." };

  const entries = (data ?? []).map((row) => ({ verse: row.verse, contentHtml: row.content_html }));

  const extractIds = [
    ...new Set(
      entries.flatMap((entry) => [...entry.contentHtml.matchAll(/data-jwpub-extract="(\d+)"/g)]).map((m) => Number(m[1]))
    ),
  ];

  const extracts: Record<number, ResearchGuideExtract> = {};
  if (extractIds.length > 0) {
    const { data: extractRows } = await supabase
      .from("bible_research_guide_extracts")
      .select("extract_id, content_html, ref_title, ref_symbol")
      .in("extract_id", extractIds);
    for (const row of extractRows ?? []) {
      extracts[row.extract_id] = { html: row.content_html, refTitle: row.ref_title, refSymbol: row.ref_symbol };
    }
  }

  return { entries, extracts };
}
