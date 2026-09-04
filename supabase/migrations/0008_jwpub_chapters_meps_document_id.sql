-- .jwlibrary backups address a publication chapter by `MepsDocumentId` (the
-- globally-unique document id), not the archive-internal sequential
-- `Document.DocumentId` this app already captures in jwpub_chapters.document_id.
-- Without this column, an imported .jwlibrary note/highlight can never be
-- matched back to an already-ingested .jwpub chapter — see
-- data/jwlibrary_schema.md's Location table notes.
--
-- Nullable: publications ingested before this migration don't have it until
-- the user re-processes them (same "Processar publicação" retry button
-- already used for ingest failures).

alter table public.jwpub_chapters add column meps_document_id integer;
