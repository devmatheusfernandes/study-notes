"use client";

import type { BibleAppendixHeader, BibleBook } from "@/app/(app)/bible-actions";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { BIBLE_BOOK_ABBREVIATIONS_PT, OLD_TESTAMENT_MAX_BOOK_ORDER } from "@/lib/bible/book-abbreviations";
import {
  BIBLE_DIVISION_BG,
  BIBLE_DIVISION_LABELS,
  divisionForBook,
} from "@/lib/bible/book-divisions";

interface BibleBookGridProps {
  /** Fetched once by bible-reader.tsx and shared across all three screens — null while loading. */
  books: BibleBook[] | null;
  onSelectBook: (bookOrder: number) => void;
  /** Fetched by bible-reader.tsx — null while loading, empty once loaded if data/nwt_st.sqlite predates the appendices table. */
  appendixHeaders: BibleAppendixHeader[] | null;
  onSelectAppendix: (mepsDocumentId: number) => void;
}

function BookButton({ book, onClick }: { book: BibleBook; onClick: () => void }) {
  const division = divisionForBook(book.bookOrder);

  return (
    <button
      type="button"
      onClick={onClick}
      // The section name is the only place the colour coding is spelled out,
      // so it carries the meaning for anyone who can't tell the tints apart.
      title={`${book.book} — ${BIBLE_DIVISION_LABELS[division]}`}
      className={cn(
        "flex aspect-square items-center justify-center px-2 py-2 text-center text-[12px] font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:aspect-auto sm:min-h-14 sm:justify-start sm:px-3 sm:py-2.5 sm:text-left sm:text-[13px]",
        BIBLE_DIVISION_BG[division]
      )}
    >
      {/* Short Portuguese abbreviation on narrow screens (dense grid, full name wouldn't fit); full name on wider ones, where there's room and it reads better — already in bible_verses.book, no extra data needed. */}
      <span className="hidden sm:inline">{book.book}</span>
      <span className="sm:hidden">{BIBLE_BOOK_ABBREVIATIONS_PT[book.bookOrder] ?? book.book.slice(0, 3)}</span>
    </button>
  );
}

/** Landing screen of /bible — full-page book grid grouped by testament, matching the JW Library app's own Bible navigation (not a Vault/drawer). */
export function BibleBookGrid({ books, onSelectBook, appendixHeaders, onSelectAppendix }: BibleBookGridProps) {
  const oldTestament = (books ?? []).filter((b) => b.bookOrder <= OLD_TESTAMENT_MAX_BOOK_ORDER);
  const newTestament = (books ?? []).filter((b) => b.bookOrder > OLD_TESTAMENT_MAX_BOOK_ORDER);

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground">NWT</span>
          <span className="font-heading text-xl">Bíblia</span>
        </div>

        {/* Same place JW Library puts its own Apêndice A/B/C tabs, next to
            the book list. Each header's own content is that section's index
            of articles — see bible-appendix-surface.tsx — so there's nothing
            else to fetch to render this as a picker. */}
        {appendixHeaders && appendixHeaders.length > 0 && (
          <div className="flex shrink-0 gap-1.5">
            {appendixHeaders.map((header) => (
              <button
                key={header.mepsDocumentId}
                type="button"
                onClick={() => onSelectAppendix(header.mepsDocumentId)}
                title={header.title}
                className="rounded-full bg-secondary px-3 py-1.5 font-mono text-[11px] text-foreground/80 transition-colors hover:bg-surface hover:text-foreground"
              >
                {header.letter}
              </button>
            ))}
          </div>
        )}
      </div>

      {books === null ? (
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
          {[0, 1].map((section) => (
            <div key={section} className="flex flex-1 flex-col gap-3">
              <Skeleton className="h-3 w-40 rounded" />
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-4 sm:gap-2">
                {Array.from({ length: section === 0 ? 39 : 27 }, (_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-none sm:aspect-auto sm:h-14" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
          <section className="flex flex-1 flex-col gap-3">
            <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
              ESCRITURAS HEBRAICO-ARAMAICAS
            </h2>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-4 sm:gap-2">
              {oldTestament.map((book) => (
                <BookButton key={book.bookOrder} book={book} onClick={() => onSelectBook(book.bookOrder)} />
              ))}
            </div>
          </section>

          <section className="flex flex-1 flex-col gap-3">
            <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
              ESCRITURAS GREGAS CRISTÃS
            </h2>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-4 sm:gap-2">
              {newTestament.map((book) => (
                <BookButton key={book.bookOrder} book={book} onClick={() => onSelectBook(book.bookOrder)} />
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
