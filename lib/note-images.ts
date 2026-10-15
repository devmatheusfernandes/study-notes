/**
 * Regex-based on purpose (not DOMParser): this needs to run both server-side
 * (deleting a whole note in notes-actions.ts) and client-side (diffing a
 * note's old vs. new body on every edit in notes-store.ts), and DOMParser
 * only exists in the browser.
 */
const NOTE_IMAGES_URL_MARKERS = [
  // Current: served by app/api/note-images/[...path]/route.ts, behind the session.
  "/api/note-images/",
  // Legacy: the bucket used to be public. Kept so old bodies are still recognised
  // (and cleaned up) — scripts/make-note-images-private.mjs rewrites them to the form above.
  "/storage/v1/object/public/note-images/",
];

/** The URL a note body stores for an image at this Storage path. */
export function noteImageUrl(storagePath: string) {
  return `/api/note-images/${storagePath}`;
}

/** Every `note-images` Storage path referenced by an `<img>` in this HTML body. */
export function extractNoteImagePaths(html: string): string[] {
  const paths: string[] = [];
  const imgSrcPattern = /<img\b[^>]*\ssrc="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = imgSrcPattern.exec(html))) {
    const src = match[1];
    for (const marker of NOTE_IMAGES_URL_MARKERS) {
      const markerIndex = src.indexOf(marker);
      if (markerIndex === -1) continue;
      const path = src.slice(markerIndex + marker.length).split(/[?#]/)[0];
      if (path) paths.push(decodeURIComponent(path));
      break;
    }
  }
  return paths;
}

/** Paths present in `oldHtml` but no longer referenced in `newHtml` — safe to delete from Storage. */
export function removedNoteImagePaths(oldHtml: string, newHtml: string): string[] {
  const oldPaths = extractNoteImagePaths(oldHtml);
  const newPaths = new Set(extractNoteImagePaths(newHtml));
  return oldPaths.filter((p) => !newPaths.has(p));
}
