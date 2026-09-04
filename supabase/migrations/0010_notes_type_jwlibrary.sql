-- public.notes.type's check constraint (0001) didn't know about "jwlibrary"
-- yet — every .jwlibrary upload failed at the notes insert step with a
-- generic "Falha ao registrar" error, since Postgres rejected the row before
-- it ever reached application code.

alter table public.notes drop constraint notes_type_check;
alter table public.notes add constraint notes_type_check
  check (type in ('nota', 'pdf', 'docx', 'xlsx', 'jwpub', 'jwlibrary', 'arquivo'));
