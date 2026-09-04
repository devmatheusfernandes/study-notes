-- Same reasoning as migrations 0011/0012: a tag created directly in Study
-- Notes (not from an imported .jwlibrary backup) has no backup to belong to.
alter table public.jwlibrary_tags alter column backup_id drop not null;

-- Lets addTagToJwlibraryNote use an idempotent upsert instead of a
-- check-then-insert race. Partial (note_id is not null) because a tag_map
-- row can also point at a bare location with no note — that variant has no
-- uniqueness rule here.
create unique index jwlibrary_tag_map_note_tag_idx
  on public.jwlibrary_tag_map(tag_id, note_id)
  where note_id is not null;
