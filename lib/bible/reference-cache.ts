import "server-only";
import { revalidateTag } from "next/cache";

/**
 * Server-side cache for the public reference content the Bible study panel
 * reads per chapter (study notes + footnotes, videos, the research guide).
 *
 * It is the same for every signed-in user and only changes when somebody
 * re-imports or re-indexes it, so a chapter is read from Postgres once and then
 * served from Next's data cache. Callers MUST verify the session first — the
 * cached loaders use the service-role client (a cached function can't read the
 * request's cookies, so the per-user client isn't an option), which is safe only
 * because these tables hold public reference content whose RLS policy is just
 * "any signed-in user may read".
 */
export const BIBLE_REFERENCE_CACHE_TAG = "bible-reference";

export const BIBLE_REFERENCE_CACHE_OPTIONS = {
  tags: [BIBLE_REFERENCE_CACHE_TAG],
  // Safety net for a change made outside the app (a seed script); imports made
  // through the app invalidate the tag themselves.
  revalidate: 60 * 60 * 24,
};

/** Drops every cached chapter — call after anything that rewrites the underlying tables. */
export function invalidateBibleReferenceCache() {
  try {
    revalidateTag(BIBLE_REFERENCE_CACHE_TAG, { expire: 0 });
  } catch {
    // Outside a request scope (a script) there is no cache to invalidate.
  }
}
