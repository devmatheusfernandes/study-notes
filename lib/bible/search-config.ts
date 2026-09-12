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
