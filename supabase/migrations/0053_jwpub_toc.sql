-- The publication's own table of contents — what the JW Library app opens a
-- publication on. A .jwpub carries it in PublicationViewItem (+ its Field
-- rows): top-level items are the tabs ("Conteúdo", "Apêndice", "Índice"), an
-- item with no document is a group heading, and a numbered item (schema 1)
-- is a chapter whose number the app labels "CAPÍTULO N".
--
-- Stored flat with a parent pointer rather than as JSON so a publication's
-- tree can be read in one query and rebuilt in the browser. Cascades from the
-- publication, so reprocessing (which recreates it) replaces it.
create table public.jwpub_toc_items (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  publication_id uuid not null references public.jwpub_publications(id) on delete cascade,
  -- PublicationViewItem.PublicationViewItemId from the archive.
  item_id integer not null,
  -- Null for a top-level item (the archive uses -1).
  parent_item_id integer,
  position integer not null,
  title text not null default '',
  -- The "number" field of a numbered item ("1", "2"…); null otherwise.
  number text,
  -- The "location" field — the printed page the item starts on.
  location text,
  schema_type integer not null default 0,
  -- Document.DocumentId this item opens; null for a group heading.
  document_id integer,
  primary key (publication_id, item_id)
);

create index jwpub_toc_items_publication_idx on public.jwpub_toc_items(publication_id, position);

alter table public.jwpub_toc_items enable row level security;

create policy "jwpub_toc_items_owner_all" on public.jwpub_toc_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
