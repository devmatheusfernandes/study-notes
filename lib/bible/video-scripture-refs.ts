/**
 * Turns one video's title and transcript into the `video_scripture_refs` rows
 * that link it to a Bible chapter (migration 0025).
 *
 * Kept out of the Server Action that writes them so the same code runs in both
 * places it's needed: the settings-page backfill over the existing catalog, and
 * `syncGlobalJwVideos`, which already has the title and transcript in memory
 * for a freshly crawled video and shouldn't have to fetch them back.
 */

import {
  extractBibleReferencesFromTitle,
  findAllBibleReferenceSnippets,
} from "./parse-reference";

export type ScriptureRefSource = "title" | "transcript";

export interface VideoScriptureRefRow {
  video_id: string;
  book_order: number;
  chapter: number;
  verse: number | null;
  end_verse: number | null;
  source: ScriptureRefSource;
  /**
   * A short excerpt of the transcript around wherever this chapter is
   * actually read out loud, or `null` when no mention of it was found in the
   * transcript at all (a themed talk that paraphrases its text rather than
   * quoting it, or a chapter-level reference whose number the transcript
   * never repeats). Used to seek a video player straight to that moment — see
   * `InlineVideoCard`'s `snippet` prop — rather than always starting at 00:00.
   */
  snippet: string | null;
}

/**
 * A ceiling on how many references one video can contribute. The worst case
 * measured across the real catalog is 54 distinct chapters in a single talk,
 * so this is pure insurance against a pathological transcript rather than a
 * limit anything legitimate runs into.
 */
const MAX_REFS_PER_VIDEO = 200;

export function buildVideoScriptureRows(
  videoId: string,
  title: string,
  contentText: string | null
): VideoScriptureRefRow[] {
  const rows: VideoScriptureRefRow[] = [];
  const seen = new Set<string>();
  /** Chapters the title already claims as the video's theme — see the transcript loop below. */
  const titleChapters = new Set<string>();

  // One transcript scan, reused for two things below: deciding whether a
  // chapter the title already claims shows up again (to skip a duplicate
  // "mencionado" row for it), and finding each reference's own playback
  // snippet — a title-sourced row wants one too, since the transcript is
  // where the talk actually reads its theme text out loud.
  const transcriptMentions = findAllBibleReferenceSnippets(contentText ?? "");

  function findSnippet(bookOrder: number, chapter: number, verse: number | null): string | null {
    // Prefer a mention of the exact verse; a talk almost always reads its
    // theme text verbatim, so this is usually an exact hit. Falling back to
    // any mention of the chapter still gets the player close, which beats
    // always starting at 00:00.
    const exact = transcriptMentions.find(
      (m) => m.bookOrder === bookOrder && m.chapter === chapter && (verse === null || m.startVerse === verse)
    );
    if (exact) return exact.snippet;
    return transcriptMentions.find((m) => m.bookOrder === bookOrder && m.chapter === chapter)?.snippet ?? null;
  }

  for (const ref of extractBibleReferencesFromTitle(title)) {
    const key = `title|${ref.bookOrder}|${ref.chapter}|${ref.startVerse ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    titleChapters.add(`${ref.bookOrder}|${ref.chapter}`);
    rows.push({
      video_id: videoId,
      book_order: ref.bookOrder,
      chapter: ref.chapter,
      verse: ref.startVerse,
      end_verse: ref.endVerse,
      source: "title",
      snippet: findSnippet(ref.bookOrder, ref.chapter, ref.startVerse),
    });
  }

  for (const mention of transcriptMentions) {
    // A talk always reads its own theme text out loud, so without this every
    // video would also be listed under "mencionado" for the very chapter it's
    // already the featured video of.
    if (titleChapters.has(`${mention.bookOrder}|${mention.chapter}`)) continue;

    const key = `transcript|${mention.bookOrder}|${mention.chapter}|${mention.startVerse ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      video_id: videoId,
      book_order: mention.bookOrder,
      chapter: mention.chapter,
      verse: mention.startVerse,
      end_verse: null,
      source: "transcript",
      snippet: mention.snippet,
    });

    if (rows.length >= MAX_REFS_PER_VIDEO) break;
  }

  return rows;
}
