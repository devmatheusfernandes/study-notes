/**
 * Regex-based on purpose (not DOMParser): this needs to run both server-side
 * (deleting a whole note in notes-actions.ts) and client-side (diffing a
 * note's old vs. new body on every edit in notes-store.ts), and DOMParser
 * only exists in the browser.
 */
const NOTE_IMAGES_URL_MARKER = "/storage/v1/object/public/note-images/";

/** Every `note-images` Storage path referenced by an `<img>` in this HTML body. */
export function extractNoteImagePaths(html: string): string[] {
  const paths: string[] = [];
  const imgSrcPattern = /<img\b[^>]*\ssrc="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = imgSrcPattern.exec(html))) {
    const src = match[1];
    const markerIndex = src.indexOf(NOTE_IMAGES_URL_MARKER);
    if (markerIndex === -1) continue;
    const path = src.slice(markerIndex + NOTE_IMAGES_URL_MARKER.length);
    if (path) paths.push(decodeURIComponent(path));
  }
  return paths;
}

/** Paths present in `oldHtml` but no longer referenced in `newHtml` — safe to delete from Storage. */
export function removedNoteImagePaths(oldHtml: string, newHtml: string): string[] {
  const oldPaths = extractNoteImagePaths(oldHtml);
  const newPaths = new Set(extractNoteImagePaths(newHtml));
  return oldPaths.filter((p) => !newPaths.has(p));
}
