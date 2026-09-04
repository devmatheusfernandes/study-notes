-- A note created directly in Study Notes (not imported from a .jwlibrary
-- backup) has no backup to belong to — see app/(app)/jwlibrary-actions.ts's
-- createJwlibraryNote. source_guid stays required/unique: a manually-created
-- note gets a freshly generated UUID, same shape a real JW Library Guid has,
-- so a future export doesn't need to special-case these.

alter table public.jwlibrary_notes alter column backup_id drop not null;
