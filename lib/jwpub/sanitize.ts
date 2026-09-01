"use client";

import DOMPurify from "dompurify";

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
    ],
    FORBID_TAGS: ["script", "style", "iframe", "form", "input", "object", "embed"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "srcset"],
  });
}

/**
 * Turns the archive's internal links into inert data attributes:
 *   jwpub://f/<id>  → data-jwpub-footnote="<id>"  (the reader opens these)
 *   jwpub://b/…, jwpub://p/… → data-jwpub-ref="…" (kept for later, not clickable in v1)
 *
 * The `href` is dropped in both cases so nothing can navigate to a scheme the
 * browser doesn't understand.
 */
export function rewriteJwpubLinks(html: string): string {
  return html.replace(
    /<a\b([^>]*?)href="jwpub:\/\/([^"]+)"([^>]*)>/gi,
    (_match, before: string, target: string, after: string) => {
      const footnote = /^f\/(?:[^/]*\/)*?(\d+)/.exec(target);
      const attr = footnote
        ? `data-jwpub-footnote="${footnote[1]}"`
        : `data-jwpub-ref="${target.replace(/"/g, "")}"`;
      return `<a${before}${attr}${after}>`;
    }
  );
}
