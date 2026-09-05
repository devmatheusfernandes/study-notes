-- Re-importing a .jwlibrary backup (a second device, or the same device
-- exported again) duplicated tags, bookmarks, tag_map rows and input fields
-- on every import: saveJwlibraryBackup (app/(app)/jwlibrary-actions.ts)
-- always plain-inserted them, unlike jwlibrary_notes/jwlibrary_usermarks
-- (migration 0009), which already dedupe on their own stable `source_guid`
-- from the export. Tag/Bookmark/InputField rows in the JW Library export
-- format carry no such stable cross-device id (see lib/jwlibrary/types.ts),
-- so we dedupe on the natural identity JW Library itself enforces instead:
-- a tag name, a bookmark slot within a publication, an input field's tag
-- within a chapter, a tag applied to a note or bare location.
--
-- Nullable location columns can't be used directly in a unique constraint —
-- Postgres never considers two NULLs equal, so e.g. two bookmarks that both
-- happen to have a null `key_symbol` would never be seen as duplicates on
-- that account. Each table below gets a `dedupe_key` generated column that
-- coalesces the identity fields to non-null text first, then a unique
-- constraint on (user_id, dedupe_key) (tag_map additionally scopes by
-- tag_id). Verified generated STORED columns work as normal ON CONFLICT
-- targets for upsert.

-- Tags: JW Library only allows one tag per name, and exactly one special
-- "Favorite" tag (tag_type = 0, name always empty) per install/account.
update public.jwlibrary_tags set name = '' where name is null;
alter table public.jwlibrary_tags alter column name set default '';
alter table public.jwlibrary_tags alter column name set not null;
alter table public.jwlibrary_tags add constraint jwlibrary_tags_user_type_name_uniq unique (user_id, tag_type, name);

-- Bookmarks: JW Library scopes a bookmark's slot to one publication/location.
alter table public.jwlibrary_bookmarks add column dedupe_key text generated always as (
  slot::text || '|' ||
  coalesce(book_number::text, '') || '|' ||
  coalesce(chapter_number::text, '') || '|' ||
  coalesce(key_symbol, '') || '|' ||
  coalesce(meps_language::text, '') || '|' ||
  coalesce(issue_tag_number::text, '') || '|' ||
  coalesce(meps_document_id::text, '') || '|' ||
  coalesce(track::text, '') || '|' ||
  coalesce(location_type::text, '')
) stored;
alter table public.jwlibrary_bookmarks add constraint jwlibrary_bookmarks_user_dedupe_uniq unique (user_id, dedupe_key);

-- Input fields: identified by their study-question tag within a location.
alter table public.jwlibrary_input_fields add column dedupe_key text generated always as (
  text_tag || '|' ||
  coalesce(book_number::text, '') || '|' ||
  coalesce(chapter_number::text, '') || '|' ||
  coalesce(key_symbol, '') || '|' ||
  coalesce(meps_language::text, '') || '|' ||
  coalesce(issue_tag_number::text, '') || '|' ||
  coalesce(meps_document_id::text, '') || '|' ||
  coalesce(track::text, '') || '|' ||
  coalesce(location_type::text, '')
) stored;
alter table public.jwlibrary_input_fields add constraint jwlibrary_input_fields_user_dedupe_uniq unique (user_id, dedupe_key);

-- Tag map: a tag applied to a note (by note_id) or to a bare location.
-- Separate from the (tag_id, note_id) index added in 0013/0014, which is
-- used by the interactive addTagToJwlibraryNote upsert and deliberately
-- leaves location-only rows undeduped there — this one also covers the
-- bulk-import path's location-only tag_map rows.
alter table public.jwlibrary_tag_map add column dedupe_key text generated always as (
  coalesce(note_id::text, '') || '|' ||
  coalesce(book_number::text, '') || '|' ||
  coalesce(chapter_number::text, '') || '|' ||
  coalesce(key_symbol, '') || '|' ||
  coalesce(meps_language::text, '') || '|' ||
  coalesce(issue_tag_number::text, '') || '|' ||
  coalesce(meps_document_id::text, '') || '|' ||
  coalesce(track::text, '') || '|' ||
  coalesce(location_type::text, '')
) stored;
alter table public.jwlibrary_tag_map add constraint jwlibrary_tag_map_user_tag_dedupe_uniq unique (user_id, tag_id, dedupe_key);
