"use client";

import DOMPurify from "dompurify";
import { extractCitationKey } from "./types";
import type { JwpubBibleCitation, JwpubExtractIndex } from "./types";

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
      "data-jwpub-pubref", "data-jwpub-pubref-pid", "data-jwpub-extract",
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
 *   jwpub://p/T:<mepsDocumentId>/<range>  → data-jwpub-pubref="<mepsDocumentId>"
 *     (plus data-jwpub-pubref-pid="<firstParagraph>" when `<range>` has one) —
 *     verified against a real archive: a cross-reference like "th study 5"
 *     is literally `jwpub://p/T:1102018445/`, where `1102018445` is the
 *     referenced document's own `MepsDocumentId` — the exact same id already
 *     stored per chapter in `jwpub_chapters.meps_document_id`. Whether this
 *     is clickable depends on whether *that* publication is in the user's own
 *     library, which can change after this one was ingested — so it's left
 *     as inert data here and resolved dynamically at read time (see
 *     resolveJwpubReferences in jwpub-actions.ts), not baked in now.
 *     **Superseded whenever `extracts` resolves the same citation** (see
 *     below) — a citation with its own embedded excerpt gets
 *     `data-jwpub-extract` *instead*, since there's then nothing to resolve
 *     or download in the first place.
 *   jwpub://p/… of any other shape → data-jwpub-ref="…" (kept, not clickable)
 *
 * The `href` is dropped in every case so nothing can navigate to a scheme the
 * browser doesn't understand. `documentId` is the current chapter's own id —
 * BibleCitation block/element numbers repeat across documents, so citations
 * must be scoped to it (pass -1, the default, for content with no such
 * scope — e.g. footnotes — which just leaves any bible ref inert).
 *
 * `extracts` resolves a citation carrying `data-xtid="<extractId>"` (the
 * archive's own `Extract.ExtractId`) to `data-jwpub-extract="<id>[,<id>...]"`
 * when the archive embeds the excerpt(s) behind that link — the caller is
 * then expected to have persisted them somewhere addressable by those ids
 * (see lib/bible/research-guide-parse.ts for the Bible reader's Guia tab and
 * lib/jwpub/ingest.ts for an ordinary uploaded publication). The value is a
 * LIST because one citation link routinely stands for several excerpts —
 * see JwpubExtractIndex in types.ts. Omit `extracts` (the default) to leave
 * every citation as a plain `data-jwpub-pubref`.
 */
export function rewriteJwpubLinks(
  html: string,
  citations: Map<string, JwpubBibleCitation> = new Map(),
  documentId: number = -1,
  extracts?: JwpubExtractIndex
): string {
  // Tracks the `data-pid` of the paragraph each link sits in, by matching
  // element open tags in the same pass as the anchors. A citation's excerpt
  // group is scoped to (document, paragraph) — the same excerpt can be cited
  // twice in one document under different links, and only the paragraph
  // tells those apart (see JwpubExtractIndex).
  let paragraphOrdinal = -1;

  return html.replace(
    /<[a-z][a-z0-9]*\b[^>]*?\bdata-pid="(\d+)"[^>]*>|<a\b([^>]*?)href="jwpub:\/\/([^"]+)"([^>]*)>/gi,
    (match: string, pid: string | undefined, before: string, target: string, after: string) => {
      if (pid !== undefined) {
        paragraphOrdinal = Number(pid);
        return match;
      }

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

      if (target.startsWith("p/")) {
        const xtid = /data-xtid="(\d+)"/.exec(before + after);
        const extractId = xtid ? Number(xtid[1]) : null;
        if (extracts && extractId !== null && extracts.byExtractId.has(extractId)) {
          // Every excerpt on THIS link, not just the one its own data-xtid
          // names — "Perspicaz, Volume 1," is a single anchor standing for
          // six different articles. Falls back to the single id when the
          // group lookup misses (a paragraph this pass couldn't track, or an
          // archive with no BeginParagraphOrdinal).
          const group =
            extracts.citationGroups.get(extractCitationKey(documentId, paragraphOrdinal, extractId)) ?? [extractId];
          return `<a${before}data-jwpub-extract="${group.join(",")}"${after}>`;
        }

        // No trailing `$` anchor — a citation can name SEVERAL targets in one
        // href, joined by `$` ("p/T:1102021206/4-5$p/T:1102021206/22-30", a
        // real one, "Seja Feliz para Sempre!, lição 6"). The old anchored
        // regex required the ENTIRE string to be one target and silently
        // matched nothing for these, falling all the way through to the
        // inert data-jwpub-ref case below — the link rendered but neither
        // "Baixar" nor a resolved reference ever appeared, no matter what.
        // Matching just the first target is a real destination instead of
        // none; the rest are ignored, same trade-off data-jwpub-pubref-pid
        // already makes for a range (it only keeps the first paragraph).
        const pubRef = /^p\/T:(\d+)\/(?:(\d+)(?:-\d+)?(?::\d+)?)?/.exec(target);
        if (pubRef) {
          const pidAttr = pubRef[2] ? ` data-jwpub-pubref-pid="${pubRef[2]}"` : "";
          return `<a${before}data-jwpub-pubref="${pubRef[1]}"${pidAttr}${after}>`;
        }
      }

      return `<a${before}data-jwpub-ref="${target.replace(/"/g, "")}"${after}>`;
    }
  );
}
