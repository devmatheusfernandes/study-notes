-- Same reasoning as migration 0011 for jwlibrary_notes: a highlight created
-- directly in Study Notes (picking a color for a selected text span, see
-- createJwlibraryNote in app/(app)/jwlibrary-actions.ts) has no backup to
-- belong to.

alter table public.jwlibrary_usermarks alter column backup_id drop not null;
