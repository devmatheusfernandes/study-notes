-- Reverses 0040's separate 'desenho' note type. Handwriting turned out not to
-- be a *kind* of note: any note can carry an ink layer over its text (the way
-- Samsung Notes lets one page hold both), so making the user choose between a
-- text note and a drawing note up front was the wrong split.
--
-- Nothing is lost by folding them back: the strokes live in note_drawings,
-- keyed by note_id, and the note editor now renders that layer for every note.

update public.notes set type = 'nota' where type = 'desenho';

alter table public.notes drop constraint notes_type_check;
alter table public.notes add constraint notes_type_check
  check (type in ('nota', 'pdf', 'docx', 'xlsx', 'jwpub', 'jwlibrary', 'arquivo'));
