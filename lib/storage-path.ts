/**
 * Ownership check for Storage object paths. The `files`/`note-audio`/`note-images`
 * buckets have no RLS, so "this path starts with my user id" IS the access
 * control — a bare `startsWith` is not enough: it accepts `${id}/../other-user/x`
 * and anything with empty, dot or backslash segments, depending on how the
 * Storage backend normalises keys. This accepts only plain `userId/segment/...`
 * keys and says no to everything else.
 */
const MAX_PATH_LENGTH = 512;

export function isOwnedStoragePath(path: unknown, userId: string): path is string {
  if (typeof path !== "string" || !userId) return false;
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  // Control characters, backslashes and percent-escapes (`%2e%2e`) have no
  // place in a key this app generated itself.
  if (/[\u0000-\u001f\u007f\\%]/.test(path)) return false;

  const segments = path.split("/");
  if (segments.length < 2) return false;
  if (segments[0] !== userId) return false;
  return segments.every((s) => s !== "" && s !== "." && s !== "..");
}
