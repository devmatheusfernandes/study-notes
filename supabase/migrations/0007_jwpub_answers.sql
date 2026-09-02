-- Personal "Your answer" fields from meeting workbook / study-edition
-- publications (the <textarea class="gen-field"> blocks jwpub content ships
-- inline). Unlike public.jwpub_chapters/footnotes, this is the user's own
-- private writing (like public.notes), so the answer text is encrypted the
-- same way — see app/(app)/jwpub-actions.ts.
--
-- A field's own `id`/`name` attributes are reused across documents (verified
-- against a real archive — not unique), so the durable key is the archive's
-- own (documentId, paragraph data-pid) pair, scoped to the publication.

create table public.jwpub_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  publication_id uuid not null references public.jwpub_publications(id) on delete cascade,
  document_id integer not null,
  pid text not null,
  answer text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publication_id, document_id, pid)
);

create index jwpub_answers_publication_document_idx on public.jwpub_answers(publication_id, document_id);

create trigger jwpub_answers_set_updated_at
  before update on public.jwpub_answers
  for each row execute function public.set_updated_at();

alter table public.jwpub_answers enable row level security;

create policy "jwpub_answers_owner_all" on public.jwpub_answers
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
