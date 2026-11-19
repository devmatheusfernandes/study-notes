import type { BibleVerseRow } from "@/app/(app)/bible-actions";

/**
 * A scripture citation as it sits inside an embedded excerpt (a Perspicaz
 * paragraph, a Research Guide entry): `<a data-jwpub-ref="b/NWTR/62:4:16-62:4:16" class="b">1Jo 4:16,</a>`.
 *
 * The chapter text of a publication has these resolved to verse ids at ingest
 * (`data-jwpub-bible-first/last`); an excerpt's are left as the archive wrote
 * them — `<bookOrder>:<chapter>:<verse>-<bookOrder>:<chapter>:<verse>`, where the
 * book is the canonical 1–66 order `bible_verses.book_order` uses. Checked
 * against the stored excerpts: the chapter and verse in the link matched the
 * visible text on every comparable anchor (3.417 of 3.417 in Perspicaz's,
 * 1.580 of 1.580 in the Research Guide's).
 */
export interface BiblePassageRef {
  bookOrder: number;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
}

const INERT_BIBLE_REF = /^b\/NWTR\/(\d{1,2}):(\d{1,3}):(\d{1,3})-(\d{1,2}):(\d{1,3}):(\d{1,3})$/;

/** `null` for anything that isn't a well-formed single-book scripture range — the link then just stays inert. */
export function parseInertBibleRef(value: string | null | undefined): BiblePassageRef | null {
  const match = value ? INERT_BIBLE_REF.exec(value) : null;
  if (!match) return null;
  const [book, startChapter, startVerse, endBook, endChapter, endVerse] = match.slice(1).map(Number);
  if (book < 1 || book > 66 || endBook !== book) return null;
  if (startChapter < 1 || endChapter < startChapter) return null;
  if (endChapter === startChapter && endVerse < startVerse) return null;
  return { bookOrder: book, startChapter, startVerse, endChapter, endVerse };
}

/** "1 João 4:16", "Gênesis 1:27-30", "Gênesis 1:27–2:3" — the heading for a passage. */
export function passageLabel(verses: BibleVerseRow[]): string {
  const first = verses[0];
  const last = verses[verses.length - 1];
  if (!first || !last) return "";
  if (first.chapter === last.chapter && first.verse === last.verse) return `${first.book} ${first.chapter}:${first.verse}`;
  if (first.chapter === last.chapter) return `${first.book} ${first.chapter}:${first.verse}-${last.verse}`;
  return `${first.book} ${first.chapter}:${first.verse}–${last.chapter}:${last.verse}`;
}
