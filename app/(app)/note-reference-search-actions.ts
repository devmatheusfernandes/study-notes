"use server";

/**
 * Backs the "@" reference menu's title-search rows (see
 * lib/notes/reference-suggestions.ts) — the part of the menu that needs a
 * server round trip, unlike the synchronous Bible-book/publication-symbol
 * matching that already runs client-side. Three sources, in parallel:
 *   - the caller's own chapters (searchOwnChapterTitles, jwpub-actions.ts)
 *   - global_publication_chapters, via the same title-weighted FTS RPC
 *     searchInsightChapters already uses for the /bible screen
 *   - global_videos, by a plain title `ilike` — lighter than
 *     search_global_videos, which is built for transcript excerpts the menu
 *     doesn't need
 * Own hits take precedence over a global hit on the same document, mirroring
 * the own-then-global fallback resolveJwpubReferences already uses.
 */

import { createClient } from "@/lib/supabase/server";
import { searchOwnChapterTitles, searchOwnChapterTitlesInPublication } from "./jwpub-actions";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface ChapterTitleHit {
  source: "own" | "global";
  publicationId: string;
  publicationTitle: string;
  symbol: string;
  documentId: number;
  chapterTitle: string;
  noteId: string | null;
}

export interface VideoTitleHit {
  videoId: string;
  title: string;
}

const CHAPTER_LIMIT = 5;
const VIDEO_LIMIT = 4;
const SCOPED_CHAPTER_LIMIT = 8;

interface GlobalChapterRpcRow {
  document_id: number;
  publication_id: string;
  publication_title: string;
  title: string;
}

async function searchGlobalChapterTitles(supabase: SupabaseClient, query: string): Promise<ChapterTitleHit[]> {
  const { data } = await supabase.rpc("search_global_publication_chapters", {
    query_text: query,
    max_results: CHAPTER_LIMIT,
    result_offset: 0,
  });

  return ((data ?? []) as GlobalChapterRpcRow[]).map((row) => ({
    source: "global" as const,
    publicationId: row.publication_id,
    publicationTitle: row.publication_title,
    symbol: "",
    documentId: row.document_id,
    chapterTitle: row.title,
    noteId: null,
  }));
}

/**
 * Same idea as searchGlobalChapterTitles, but scoped to one already-named
 * publication (see searchOwnChapterTitlesInPublication's own comment) — a
 * plain `ilike` against global_publication_chapters directly rather than the
 * title-weighted FTS RPC, since with the publication already known there's
 * nothing left to rank across. Also allows an empty query, to browse the
 * publication's chapters in order before typing anything.
 */
async function searchGlobalChapterTitlesInPublication(
  supabase: SupabaseClient,
  symbol: string,
  query: string,
  limit: number
): Promise<ChapterTitleHit[]> {
  const { data: publication } = await supabase
    .from("global_publications")
    .select("id, title")
    .ilike("symbol", symbol)
    .maybeSingle();
  if (!publication) return [];

  let request = supabase
    .from("global_publication_chapters")
    .select("document_id, title")
    .eq("publication_id", publication.id)
    .order("position", { ascending: true })
    .limit(limit);

  const trimmed = query.trim();
  if (trimmed) request = request.ilike("title", `%${trimmed}%`);

  const { data } = await request;
  return (data ?? []).map((row) => ({
    source: "global" as const,
    publicationId: publication.id,
    publicationTitle: publication.title,
    symbol,
    documentId: row.document_id,
    chapterTitle: row.title,
    noteId: null,
  }));
}

async function searchGlobalVideoTitles(supabase: SupabaseClient, query: string): Promise<VideoTitleHit[]> {
  const { data } = await supabase
    .from("global_videos")
    .select("id, title")
    .ilike("title", `%${query}%`)
    .limit(VIDEO_LIMIT);

  return (data ?? []).map((row) => ({ videoId: row.id, title: row.title }));
}

export async function searchNoteReferenceCandidates(
  query: string,
  options?: {
    /**
     * Set once the "@" menu's query has already named a publication (see
     * publicationScopeOf) — the search then looks only inside that one
     * publication's chapters, by title, and skips videos entirely (a
     * publication has no videos to find).
     */
    publicationSymbol?: string;
  }
): Promise<{ chapters: ChapterTitleHit[]; videos: VideoTitleHit[] }> {
  const trimmed = query.trim();
  const symbol = options?.publicationSymbol?.trim().toLowerCase();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { chapters: [], videos: [] };

  if (symbol) {
    const [ownResult, globalChapters] = await Promise.all([
      searchOwnChapterTitlesInPublication(symbol, trimmed, SCOPED_CHAPTER_LIMIT),
      searchGlobalChapterTitlesInPublication(supabase, symbol, trimmed, SCOPED_CHAPTER_LIMIT),
    ]);
    const ownHits: ChapterTitleHit[] = ownResult.hits.map((hit) => ({ source: "own", ...hit }));
    const ownDocumentIds = new Set(ownHits.map((hit) => hit.documentId));
    const dedupedGlobal = globalChapters.filter((hit) => !ownDocumentIds.has(hit.documentId));
    return { chapters: [...ownHits, ...dedupedGlobal].slice(0, SCOPED_CHAPTER_LIMIT), videos: [] };
  }

  if (trimmed.length < 2) return { chapters: [], videos: [] };

  const [ownResult, globalChapters, videos] = await Promise.all([
    searchOwnChapterTitles(trimmed, CHAPTER_LIMIT),
    searchGlobalChapterTitles(supabase, trimmed),
    searchGlobalVideoTitles(supabase, trimmed),
  ]);

  const ownHits: ChapterTitleHit[] = ownResult.hits.map((hit) => ({ source: "own", ...hit }));
  const ownDocumentIds = new Set(ownHits.map((hit) => hit.documentId));
  const dedupedGlobal = globalChapters.filter((hit) => !ownDocumentIds.has(hit.documentId));

  return {
    chapters: [...ownHits, ...dedupedGlobal].slice(0, CHAPTER_LIMIT),
    videos,
  };
}
