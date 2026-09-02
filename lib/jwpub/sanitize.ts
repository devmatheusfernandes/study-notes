"use client";

import DOMPurify from "dompurify";
import type { JwpubBibleCitation } from "./types";

/**
 * Chapter HTML comes out of a third-party file, so per CLAUDE.md's rule about
 * untrusted content it never reaches `dangerouslySetInnerHTML` unsanitized.
 *
 * Internal `jwpub://` links are rewritten to `data-*` attributes *before* this
 * runs (see rewriteJwpubLinks), so DOMPurify only has to allow `data-*` —
 * which it does by default — instead of whitelisting an exotic URI scheme.
 */
export function sanitizeChapterHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_ATTR: [
      "class", "id", "style", "src", "alt", "title", "href", "colspan", "rowspan",
      "data-jwpub-footnote", "data-jwpub-ref", "data-pid", "data-key",
      "data-jwpub-bible-first", "data-jwpub-bible-last",
    ],
    FORBID_TAGS: ["script", "style", "iframe", "form", "input", "object", "embed"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "srcset"],
  });
}

/**
 * Turns the archive's internal links into inert data attributes:
 *   jwpub://f/<id>          → data-jwpub-footnote="<id>"  (the reader opens these)
 *   jwpub://b/NWTR/…, with a sibling `data-bid="<block>-<element>"` attribute
 *     → data-jwpub-bible-first/last="<verseId>" when `citations` resolves
 *     `"<documentId>:<block>:<element>"` (the reader opens these too — see
 *     readBibleCitations in parser.ts for why the href itself isn't the key);
 *     falls back to data-jwpub-ref otherwise
 *   jwpub://p/…             → data-jwpub-ref="…" (kept for later, not clickable in v1)
 *
 * The `href` is dropped in every case so nothing can navigate to a scheme the
 * browser doesn't understand. `documentId` is the current chapter's own id —
 * BibleCitation block/element numbers repeat across documents, so citations
 * must be scoped to it (pass -1, the default, for content with no such
 * scope — e.g. footnotes — which just leaves any bible ref inert).
 */
export function rewriteJwpubLinks(
  html: string,
  citations: Map<string, JwpubBibleCitation> = new Map(),
  documentId: number = -1
): string {
  return html.replace(
    /<a\b([^>]*?)href="jwpub:\/\/([^"]+)"([^>]*)>/gi,
    (_match, before: string, target: string, after: string) => {
      const footnote = /^f\/(?:[^/]*\/)*?(\d+)/.exec(target);
      if (footnote) {
        return `<a${before}data-jwpub-footnote="${footnote[1]}"${after}>`;
      }

      if (target.startsWith("b/")) {
        const bid = /data-bid="(\d+)-(\d+)"/.exec(before + after);
        const citation = bid ? citations.get(`${documentId}:${bid[1]}:${bid[2]}`) : undefined;
        if (citation) {
          return `<a${before}data-jwpub-bible-first="${citation.firstVerseId}" data-jwpub-bible-last="${citation.lastVerseId}"${after}>`;
        }
      }

      return `<a${before}data-jwpub-ref="${target.replace(/"/g, "")}"${after}>`;
    }
  );
}
