"use client";

import type { BibleBook } from "@/app/(app)/bible-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { BIBLE_BOOK_ABBREVIATIONS_PT, OLD_TESTAMENT_MAX_BOOK_ORDER } from "@/lib/bible/book-abbreviations";

interface BibleBookGridProps {
  /** Fetched once by bible-reader.tsx and shared across all three screens — null while loading. */
  books: BibleBook[] | null;
  onSelectBook: (bookOrder: number) => void;
}

function BookButton({ book, onClick }: { book: BibleBook; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex aspect-square items-center justify-center rounded-xl bg-secondary px-2 py-2 text-center text-[12px] font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:aspect-auto sm:min-h-14 sm:justify-start sm:px-3 sm:py-2.5 sm:text-left sm:text-[13px]"
    >
      {/* Short Portuguese abbreviation on narrow screens (dense grid, full name wouldn't fit); full name on wider ones, where there's room and it reads better — already in bible_verses.book, no extra data needed. */}
      <span className="hidden sm:inline">{book.book}</span>
      <span className="sm:hidden">{BIBLE_BOOK_ABBREVIATIONS_PT[book.bookOrder] ?? book.book.slice(0, 3)}</span>
    </button>
  );
}

/** Landing screen of /bible — full-page book grid grouped by testament, matching the JW Library app's own Bible navigation (not a Vault/drawer). */
export function BibleBookGrid({ books, onSelectBook }: BibleBookGridProps) {
  const oldTestament = (books ?? []).filter((b) => b.bookOrder <= OLD_TESTAMENT_MAX_BOOK_ORDER);
  const newTestament = (books ?? []).filter((b) => b.bookOrder > OLD_TESTAMENT_MAX_BOOK_ORDER);

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground">NWT</span>
        <span className="font-heading text-xl">Bíblia</span>
      </div>

      {books === null ? (
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
          {[0, 1].map((section) => (
            <div key={section} className="flex flex-1 flex-col gap-3">
              <Skeleton className="h-3 w-40 rounded" />
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-4 sm:gap-2">
                {Array.from({ length: section === 0 ? 39 : 27 }, (_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-xl sm:aspect-auto sm:h-14" />
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
