-- Verse-to-verse cross references, seeded from data/cross_references.sqlite
-- (see scripts/seed-cross-references.mjs) — same read-only reference-content
-- shape as bible_verses (migration 0006): no user_id, seeded by script only,
-- never written by the app.
create table public.bible_cross_references (
  id bigint generated always as identity primary key,
  book_order integer not null,
  chapter integer not null,
  verse integer not null,
  rank integer not null,
  ref_book_order integer not null,
  ref_chapter integer not null,
  ref_start_verse integer not null,
  ref_end_verse integer
);

create index bible_cross_references_verse_idx
  on public.bible_cross_references(book_order, chapter, verse, rank);

alter table public.bible_cross_references enable row level security;

create policy "bible_cross_references_read_authenticated" on public.bible_cross_references
  for select to authenticated using (true);
