-- The only existing index on bible_verses is (book, chapter, verse) — the
-- text book name. Every hot read path (getBibleChapterVerses,
-- getBibleChapterCount, getBibleVerseCount, getBibleVerseByReference,
-- getBibleVerseRange) filters by book_order (the integer canonical order)
-- instead, which had no matching index: confirmed via EXPLAIN ANALYZE that
-- getBibleChapterCount did a full Seq Scan (~53ms, 31k rows) and
-- getBibleChapterVerses used the wrong index column (~17ms, scanning every
-- book's same-chapter rows before filtering). bible_cross_references
-- already leads with book_order and returns in <1ms — this brings
-- bible_verses to the same shape.
create index bible_verses_book_order_chapter_verse_idx
  on public.bible_verses(book_order, chapter, verse);
