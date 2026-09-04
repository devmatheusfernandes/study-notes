/**
 * Notes created in Study Notes store Tiptap HTML in the same `content`
 * column as notes imported from a real .jwlibrary backup, which are already
 * plain text (see jwlibrary-note-editor-vault.tsx's RichTextEditor, and the
 * "plain text or Tiptap HTML" comment repeated across jwlibrary-actions.ts).
 * The real JW Library app's own Note.Content column is plain text — writing
 * raw HTML there (`<p>123</p>`) makes the official app show the literal tags
 * instead of rendering them, confirmed by exporting and reimporting.
 *
 * Regex-based, not DOMParser (this runs server-side in the export route,
 * where DOMParser doesn't exist — same reasoning as lib/note-images.ts).
 * Applied unconditionally on export: stripping tags from already-plain text
 * is a safe no-op, since plain text essentially never contains a literal
 * `<tag>`.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return html;
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
