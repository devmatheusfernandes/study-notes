-- A Psalm superscription is addressed with verse "0" in the Research
-- Guide's own heading href (jwpub://b/NWTR/19:3:0-19:3:0, labeled
-- "3:cabeçalho" in the visible text) -- the same sentinel public.bible_verses
-- and bible_study_notes already translate to a null verse rather than
-- storing literally. bible_research_guide's original `verse smallint not
-- null check (verse > 0)` rejected that null, which is what made a real
-- import fail partway through: the unique-per-request delete-then-insert
-- batch containing the first Psalm superscription (46 rows total, confirmed
-- against the real file -- all in Salmo) violated the check constraint and
-- aborted that whole batch.
--
-- Column change, not just a looser check: `verse` becomes nullable so a
-- superscription is represented the exact same way as everywhere else in
-- this schema, not as a magic 0.

alter table public.bible_research_guide
  alter column verse drop not null;

alter table public.bible_research_guide
  drop constraint bible_research_guide_verse_check;

alter table public.bible_research_guide
  add constraint bible_research_guide_verse_check check (verse is null or verse > 0);

-- The uniqueness guarantee still needs to hold for the null case (one
-- superscription entry per chapter) -- Postgres treats every NULL as
-- distinct under a plain `unique`, which would have silently let duplicate
-- superscription rows through on a retry. `nulls not distinct` (PG 15+, the
-- same fix already used for video_scripture_refs in migration 0025) closes
-- that gap.
alter table public.bible_research_guide
  drop constraint bible_research_guide_book_order_chapter_verse_key;

alter table public.bible_research_guide
  add constraint bible_research_guide_book_order_chapter_verse_key
  unique nulls not distinct (book_order, chapter, verse);
