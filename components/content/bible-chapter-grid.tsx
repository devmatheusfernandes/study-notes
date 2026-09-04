"use client";

import { ChevronLeft } from "lucide-react";

interface BibleChapterGridProps {
  bookName: string;
  /** Fetched by bible-reader.tsx (shared with its own prev/next bounds logic) — null while loading. */
  chapterCount: number | null;
  onSelectChapter: (chapter: number) => void;
  onBack: () => void;
}

/** Second screen of /bible's book/chapter picker — full-page chapter grid for one book, matching the JW Library app. */
export function BibleChapterGrid({ bookName, chapterCount, onSelectChapter, onBack }: BibleChapterGridProps) {
  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[13px] text-foreground/80 transition-colors hover:bg-surface"
      >
        <ChevronLeft className="size-4" />
        {bookName}
      </button>

      <h1 className="font-heading text-2xl uppercase">{bookName}</h1>

      {chapterCount === null ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">carregando…</p>
      ) : (
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-[repeat(20,minmax(0,1fr))]">
          {Array.from({ length: chapterCount }, (_, i) => i + 1).map((chapter) => (
            <button
              key={chapter}
              type="button"
              onClick={() => onSelectChapter(chapter)}
              className="flex aspect-square items-center justify-center rounded-xl bg-secondary text-[13px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {chapter}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
