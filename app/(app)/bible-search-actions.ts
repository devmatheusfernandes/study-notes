"use server";

import { createClient } from "@/lib/supabase/server";
import { BIBLE_SEARCH_PAGE_SIZE } from "@/lib/bible/search-config";

export interface BibleVerseHit {
  id: number;
  book: string;
  bookOrder: number;
  chapter: number;
  /** `null` for a Psalm superscription, which has no verse number. */
  verse: number | null;
  text: string;
  /** Already-escaped HTML with `<mark>` around the matched words — see `toHighlightedHtml`. */
  headline: string;
}

export interface VideoHit {
  videoId: string;
  title: string;
  coverImage: string | null;
  videoUrl: string | null;
  subtitlesUrl: string | null;
  durationFormatted: string | null;
  /** Already-escaped HTML with `<mark>` around the matched words, from the transcript. */
  headline: string;
  /** Plain text of the same excerpt, for InlineVideoCard's snippet → timestamp seek. */
  snippet: string;
}

/**
 * `search_bible_verses` / `search_global_videos` mark matches with the control
 * characters \x01 and \x02 rather than real tags (see migration 0025): a video
 * transcript comes from JW.org's subtitle files, so its text is third-party
 * content that must never reach the DOM as markup. Escaping the whole string
 * first and only then swapping the sentinels means a "<" that came from the
 * subtitles stays a literal "<", and the only tags in the output are the ones
 * added right here.
 */
const MARK_START = "";
const MARK_END = "";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toHighlightedHtml(headline: string | null): string {
  if (!headline) return "";
  return escapeHtml(headline)
    .split(MARK_START)
    .join("<mark>")
    .split(MARK_END)
    .join("</mark>");
}

/** The same excerpt without any markup — what InlineVideoCard matches against the VTT to find the right timestamp. */
function toPlainSnippet(headline: string | null): string {
  if (!headline) return "";
  return headline.split(MARK_START).join("").split(MARK_END).join("");
}

interface VerseRpcRow {
  id: number;
  book: string;
  book_order: number;
  chapter: number;
  verse: number | null;
  text: string | null;
  headline: string | null;
}

interface VideoRpcRow {
  id: string;
  title: string;
  cover_image: string | null;
  video_url: string | null;
  subtitles_url: string | null;
  duration_formatted: string | null;
  headline: string | null;
}

/**
 * Both tables are public reference content readable by any signed-in user, so
 * the session check here is about not answering at all when signed out — not
 * about scoping rows. RLS on `bible_verses` / `global_videos` still applies to
 * the query itself (the RPCs are SECURITY INVOKER on purpose).
 */
export async function searchBibleVerses(
  query: string,
  offset = 0
): Promise<{ verses?: BibleVerseHit[]; error?: string }> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { verses: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase.rpc("search_bible_verses", {
    query_text: trimmed,
    max_results: BIBLE_SEARCH_PAGE_SIZE,
    result_offset: Math.max(0, offset),
  });

  if (error) return { error: "Não foi possível buscar na Bíblia." };

  return {
    verses: ((data ?? []) as VerseRpcRow[]).map((row) => ({
      id: row.id,
      book: row.book,
      bookOrder: row.book_order,
      chapter: row.chapter,
      verse: row.verse,
      text: row.text ?? "",
      headline: toHighlightedHtml(row.headline),
    })),
  };
}

export async function searchVideoTranscripts(
  query: string,
  offset = 0
): Promise<{ videos?: VideoHit[]; error?: string }> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { videos: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase.rpc("search_global_videos", {
    query_text: trimmed,
    max_results: BIBLE_SEARCH_PAGE_SIZE,
    result_offset: Math.max(0, offset),
  });

  if (error) return { error: "Não foi possível buscar nos vídeos." };

  return {
    videos: ((data ?? []) as VideoRpcRow[]).map((row) => ({
      videoId: row.id,
      title: row.title,
      coverImage: row.cover_image,
      videoUrl: row.video_url,
      subtitlesUrl: row.subtitles_url,
      durationFormatted: row.duration_formatted,
      headline: toHighlightedHtml(row.headline),
      snippet: toPlainSnippet(row.headline),
    })),
  };
}

/**
 * Both lists' first page in one round trip — what the results screen asks for
 * on a fresh search. "Carregar mais" then pages each list on its own through
 * the two actions above.
 */
export async function searchBibleAndVideos(
  query: string
): Promise<{ verses: BibleVerseHit[]; videos: VideoHit[]; error?: string }> {
  const [verseResult, videoResult] = await Promise.all([
    searchBibleVerses(query),
    searchVideoTranscripts(query),
  ]);

  return {
    verses: verseResult.verses ?? [],
    videos: videoResult.videos ?? [],
    error: verseResult.error ?? videoResult.error,
  };
}

/** Where a video's link to a chapter came from — its title (the talk's theme) or a passage read out loud in it. */
export type ScriptureRefSource = "title" | "transcript";

export interface ChapterVideo {
  videoId: string;
  title: string;
  coverImage: string | null;
  videoUrl: string | null;
  subtitlesUrl: string | null;
  durationFormatted: string | null;
  source: ScriptureRefSource;
  /** Verses of this chapter the video points at — empty for a chapter-wide reference. */
  verses: number[];
  /** A transcript excerpt around wherever the chapter is actually read out loud, for `InlineVideoCard` to seek to — `null` when no such mention was found. */
  snippet: string | null;
}

interface ChapterVideoRpcRow {
  video_id: string;
  title: string;
  cover_image: string | null;
  video_url: string | null;
  subtitles_url: string | null;
  duration_formatted: string | null;
  source: ScriptureRefSource;
  verses: number[] | null;
  snippet: string | null;
}

/**
 * Videos linked to one Bible chapter, for the study panel's "Vídeos" tab.
 * Already ordered title-first, then newest — see `get_chapter_videos`.
 *
 * A video that both takes its theme from this chapter AND reads it out loud
 * comes back twice (one row per source); the caller keeps the `title` row and
 * drops the duplicate, so a talk about the chapter is never also listed as
 * merely mentioning it.
 */
export async function getChapterVideos(
  bookOrder: number,
  chapter: number
): Promise<{ videos?: ChapterVideo[]; error?: string }> {
  if (!Number.isFinite(bookOrder) || !Number.isFinite(chapter)) {
    return { error: "Capítulo inválido." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase.rpc("get_chapter_videos", {
    p_book_order: bookOrder,
    p_chapter: chapter,
  });

  if (error) return { error: "Não foi possível carregar os vídeos do capítulo." };

  const seen = new Set<string>();
  const videos: ChapterVideo[] = [];
  for (const row of (data ?? []) as ChapterVideoRpcRow[]) {
    if (seen.has(row.video_id)) continue;
    seen.add(row.video_id);
    videos.push({
      videoId: row.video_id,
      title: row.title,
      coverImage: row.cover_image,
      videoUrl: row.video_url,
      subtitlesUrl: row.subtitles_url,
      durationFormatted: row.duration_formatted,
      source: row.source,
      verses: (row.verses ?? []).slice().sort((a, b) => a - b),
      snippet: row.snippet,
    });
  }

  return { videos };
}
