/**
 * Splits one decoded Research Guide `Document.Content` (a whole book, or a
 * group of small books — Gênesis is 444KB on its own) into per-verse
 * citation blocks.
 *
 * Verified against the real publication (símbolo `rsg19`): every verse in a
 * book starts with its own heading paragraph —
 *   <p class="se"><a href="jwpub://b/NWTR/1:1:1-1:1:1" data-bid="1-1" class="b"><strong>1:1</strong></a></p>
 * — followed by zero or more citation paragraphs (class `su`/`sk`) until the
 * next heading. The heading's own `href` already spells out
 * book:chapter:verse directly, so this needs no join against `BibleCitation`
 * at all — unlike the rest of this app's jwpub handling, which resolves
 * `data-bid` against that table because a `Document.Content` href alone is
 * normally *not* trustworthy for verse numbers (see readBibleCitations in
 * lib/jwpub/parser.ts). The Research Guide is the one place it is: its own
 * heading anchors are generated directly from the verse being indexed, not
 * from a cross-reference elsewhere in running prose.
 */

const VERSE_HEADING = /<p\b[^>]*class="se"[^>]*>\s*<a\b[^>]*href="jwpub:\/\/b\/NWTR\/(\d{1,2}):(\d{1,3}):(\d{1,3})(?:-\d{1,2}:\d{1,3}:\d{1,3})?"[^>]*>[\s\S]*?<\/a>\s*<\/p>/g;

/**
 * Bump this whenever a change to how a `.jwpub` upload gets parsed/rewritten
 * (here, in lib/jwpub/sanitize.ts, or in the upload card itself) should force
 * a reimport even for someone reuploading the exact same file —
 * `checkResearchGuideNeedsImport` in app/(app)/research-guide-actions.ts
 * otherwise only compares the file's own hash, which doesn't change just
 * because the app's own parsing logic did. History:
 *   1 — initial per-verse citation import (no embedded excerpts)
 *   2 — embeds Extract content inline (data-jwpub-extract) and stops
 *       silently dropping multi-target citations (a `$`-joined href like
 *       "Seja Feliz para Sempre!, lição 6" used to match nothing at all)
 *   3 — fixes WHICH excerpt a citation resolves to. Version 2 read
 *       `data-xtid` as a `HyperlinkId`, but it is the `ExtractId`; the two
 *       are unrelated id spaces, so essentially every excerpt the Guia tab
 *       showed was some other publication's article (`data-xtid="5807"`,
 *       "Perspicaz, Volume 1" at Gênesis 1:1, resolved to a 2004 Watchtower
 *       piece on humility). Also emits the citation's WHOLE excerpt group,
 *       not just the first — that Perspicaz link alone stands for six
 *       different articles — and imports Extract.Caption/RefMepsDocumentId,
 *       which is where the cited article's name actually lives.
 */
export const RESEARCH_GUIDE_IMPORT_VERSION = 3;

export interface ResearchGuideVerseBlock {
  bookOrder: number;
  chapter: number;
  /**
   * `null` for a Psalm superscription — the guide addresses one with verse
   * `0` in its own heading href (`jwpub://b/NWTR/19:3:0-19:3:0`, labeled
   * "3:cabeçalho" in the visible text), the same sentinel-then-null
   * translation `public.bible_verses`/`bible_study_notes` already do for the
   * identical case elsewhere in this app.
   */
  verse: number | null;
  /** Raw HTML between this verse's heading and the next — not yet sanitized/rewritten (see rewriteJwpubLinks/sanitizeChapterHtml in lib/jwpub/sanitize.ts, applied by the caller). */
  html: string;
}

export function splitResearchGuideDocument(documentHtml: string): ResearchGuideVerseBlock[] {
  const matches = [...documentHtml.matchAll(VERSE_HEADING)];
  const blocks: ResearchGuideVerseBlock[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : documentHtml.length;
    const html = documentHtml.slice(start, end).trim();
    if (!html) continue; // A verse heading with no citations after it (rare, but seen for verses the guide doesn't cover) contributes nothing.

    const verse = Number(match[3]);
    blocks.push({
      bookOrder: Number(match[1]),
      chapter: Number(match[2]),
      verse: verse === 0 ? null : verse,
      html,
    });
  }

  return blocks;
}
