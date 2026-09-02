-- Full NWT (Portuguese) verse text, seeded once from data/NWT.sqlite via
-- `npm run seed:bible` (see scripts/seed-bible.mjs). `id` matches the
-- `BibleVerseId` scheme used internally by JW Library / .jwpub archives, so a
-- citation resolved out of a publication's BibleCitation table can be looked
-- up here with zero conversion — see data/NWT_structure.md.
--
-- Public reference content, not user data: no user_id column, RLS just needs
-- every signed-in user to be able to read it. Writes only ever happen through
-- the seed script (service role / direct DATABASE_URL), never from the app.

create table public.bible_verses (
  id integer primary key,
  book text not null,
  chapter integer not null,
  verse integer,
  text text,
  is_superscription boolean not null default false,
  book_order integer not null
);

create index bible_verses_book_chapter_verse_idx on public.bible_verses(book, chapter, verse);

alter table public.bible_verses enable row level security;

create policy "bible_verses_read_authenticated" on public.bible_verses
  for select
  to authenticated
  using (true);
