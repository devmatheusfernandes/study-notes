/**
 * Shared between the server-only upload/download actions and the one-off
 * bucket-provisioning script — keeping the limits in one place so the bucket's
 * own enforcement and the app's pre-checks never drift apart.
 */
export const FILES_BUCKET = "files";

/** Extension → the content-type we force on upload. Never trust the browser-supplied MIME type. */
export const ALLOWED_EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  jwpub: "application/octet-stream",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const ALLOWED_MIME_TYPES = [...new Set(Object.values(ALLOWED_EXTENSIONS))];

/** 15 MB — generous for study documents, bounded enough to keep uploads and storage costs predictable. */
export const MAX_FILE_SIZE = 15 * 1024 * 1024;

/**
 * Per-extension overrides for `MAX_FILE_SIZE`. A `.jwpub` is a whole
 * publication (an archive of a SQLite database plus every illustration),
 * and real ones routinely blow past 15 MB — 60 MB still fits inside the
 * 80 MB `serverActions.bodySizeLimit`/`proxyClientMaxBodySize` pair in
 * next.config.ts, which is the real ceiling.
 */
export const MAX_FILE_SIZE_BY_EXTENSION: Record<string, number> = {
  jwpub: 60 * 1024 * 1024,
};

export function maxSizeForExtension(extension: string) {
  return MAX_FILE_SIZE_BY_EXTENSION[extension] ?? MAX_FILE_SIZE;
}

/** Caps a single upload request — also keeps it under the Server Action body-size limit in next.config.ts. */
export const MAX_FILES_PER_BATCH = 5;

/** Sliding-window abuse guard, checked against the user's own recent uploads (see app/(app)/files-actions.ts). */
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const RATE_LIMIT_MAX_UPLOADS = 20;

/**
 * Separate from `files` on purpose: images embedded inline in a note's rich
 * text need a stable, unauthenticated URL (an <img src>, possibly cached by
 * the browser/CDN for a long time) — the `files` bucket's 60s signed URLs
 * can't serve that. This bucket is provisioned `public: true` (anon read),
 * writes still go through the service-role client only. The `user_id/`
 * path prefix (same convention as `files`) keeps objects from being
 * guessable even though the bucket itself is publicly readable.
 */
export const NOTE_IMAGES_BUCKET = "note-images";

export const ALLOWED_IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export const ALLOWED_IMAGE_MIME_TYPES = [...new Set(Object.values(ALLOWED_IMAGE_EXTENSIONS))];

/** 8 MB — inline note images don't need the same headroom as document uploads. */
export const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

export const IMAGE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const IMAGE_RATE_LIMIT_MAX_UPLOADS = 40;

/**
 * Illustrations extracted out of a `.jwpub` archive. Public-read for the same
 * reason as `note-images` (an <img src> in stored chapter HTML needs a stable
 * URL), but kept in its own bucket so deleting a publication is a single
 * prefix sweep: `${user_id}/${publication_id}/`.
 */
export const JWPUB_MEDIA_BUCKET = "jwpub-media";

/** A single publication can carry hundreds of illustrations, so the note-image ceiling of 40 would choke on the first real file. */
export const JWPUB_MEDIA_RATE_LIMIT_MAX_UPLOADS = 1500;

/** How many images go up per `uploadPublicationMedia` call — keeps each request well inside the body-size limit. */
export const JWPUB_MEDIA_BATCH_SIZE = 20;
