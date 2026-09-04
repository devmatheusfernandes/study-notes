-- Migration 0013's partial index (`where note_id is not null`) can't be used
-- as an `ON CONFLICT (tag_id, note_id)` target unless the INSERT repeats the
-- exact same predicate — which supabase-js's `.upsert(..., { onConflict })`
-- has no way to express. Every addTagToJwlibraryNote upsert was silently
-- failing with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification" (confirmed against the live DB), which is why a
-- tag assignment looked like it worked (optimistic UI update) but never
-- actually persisted.
--
-- A full (non-partial) unique index fixes this and works exactly the same
-- for our purposes: Postgres never considers two NULLs equal for uniqueness,
-- so multiple location-only tag_map rows (note_id is null) for the same tag
-- still coexist just fine — verified directly against the DB before writing
-- this migration.
drop index if exists public.jwlibrary_tag_map_note_tag_idx;
create unique index jwlibrary_tag_map_note_tag_idx on public.jwlibrary_tag_map(tag_id, note_id);
