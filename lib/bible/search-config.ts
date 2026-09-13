/**
 * Shared between the Bible search Server Actions and the results screen that
 * pages through them.
 *
 * In its own module rather than alongside the actions because a `"use server"`
 * file may only export async functions — exporting a plain constant from one
 * makes Next drop *every* export in that module, which fails the build with a
 * confusing "the module has no exports at all".
 */

/** How many hits one page of either result list holds. */
export const BIBLE_SEARCH_PAGE_SIZE = 20;

/**
 * Minimum characters (trimmed) before the search-as-you-type debounce in
 * bible-reader.tsx fires a query, and before the Server Actions in
 * bible-search-actions.ts answer at all. Raised from 2 to 3: at 2 letters,
 * every natural typing pause (350ms) fired a real query for a two-letter
 * prefix like "ri" — full-text search can't do prefix matching, so that
 * either came back empty or, worse, matched some unrelated short lexeme via
 * the typo fallback (pt_or_tsquery), flashing an unrelated result before the
 * word was even finished. Enter still searches immediately regardless of
 * this minimum's debounce, but Enter on fewer than this many letters is a
 * no-op — there's nothing meaningful to search yet either way.
 */
export const BIBLE_SEARCH_MIN_LENGTH = 3;
