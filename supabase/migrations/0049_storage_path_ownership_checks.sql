-- Defence in depth for Storage ownership. The Storage buckets have no RLS, so
-- the app checks that a row's path lives under the owner's own prefix — but
-- `notes.storage_path` / `note_drawings.audio_path` are writable by the row's
-- owner straight through PostgREST, and the vectorizer/ingest code downloads
-- them with the service-role client. These constraints make a path pointing
-- into someone else's prefix (or containing `..`) impossible to store at all.

alter table public.notes
  add constraint notes_storage_path_owned
  check (
    storage_path is null
    or (
      storage_path like user_id::text || '/%'
      and storage_path !~ '(^|/)\.\.?(/|$)'
      and storage_path !~ '//'
    )
  ) not valid;
alter table public.notes validate constraint notes_storage_path_owned;

alter table public.note_drawings
  add constraint note_drawings_audio_path_owned
  check (
    audio_path is null
    or (
      audio_path like user_id::text || '/%'
      and audio_path !~ '(^|/)\.\.?(/|$)'
      and audio_path !~ '//'
    )
  ) not valid;
alter table public.note_drawings validate constraint note_drawings_audio_path_owned;
