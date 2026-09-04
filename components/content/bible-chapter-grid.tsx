"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BIBLE_DIVISION_BG, divisionForBook } from "@/lib/bible/book-divisions";
import { BibleBookOutline } from "./bible-book-outline";

interface BibleChapterGridProps {
  bookName: string;
  /** Canonical 1-66 order of the book being shown — only used to tint the grid with that book's section colour. */
  bookOrder: number | null;
  /** Fetched by bible-reader.tsx (shared with its own prev/next bounds logic) — null while loading. */
  chapterCount: number | null;
  onSelectChapter: (chapter: number) => void;
  /** Jumping in from the book outline lands on a specific verse, not just the chapter. */
  onSelectSection: (chapter: number, verse: number | null) => void;
  onBack: () => void;
}

type PickerTab = "capitulos" | "esboco";

/**
 * Second screen of /bible's book/chapter picker — the chapter grid and the
 * book's thematic outline as two tabs, matching the JW Library app.
 *
 * Tabs rather than a collapsible block above the grid: Salmos alone has ~556
 * outline rows, so expanding it in place either buried the grid or needed its
 * own scroll container inside a page that already scrolls.
 */
export function BibleChapterGrid({
  bookName,
  bookOrder,
  chapterCount,
  onSelectChapter,
  onSelectSection,
  onBack,
}: BibleChapterGridProps) {
  const [tab, setTab] = useState<PickerTab>("capitulos");

  // Every chapter of a book belongs to that book's section, so the whole grid
  // takes one tint — the same colour the book's own tile had on the previous
  // screen, which is what makes the transition between the two read as
  // "still inside Mateus".
  const divisionBg = bookOrder ? BIBLE_DIVISION_BG[divisionForBook(bookOrder)] : "bg-secondary";
  const gridClass =
    "grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-[repeat(20,minmax(0,1fr))]";

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

      <Tabs value={tab} onValueChange={(value) => setTab(value as PickerTab)}>
        <TabsList className="self-start">
          <TabsTrigger value="capitulos">Capítulos</TabsTrigger>
          <TabsTrigger value="esboco">Esboço</TabsTrigger>
        </TabsList>

        <TabsContent value="capitulos" className="pt-2">
          {chapterCount === null ? (
            <div className={gridClass}>
              {Array.from({ length: 30 }, (_, i) => (
                <Skeleton key={i} className="aspect-square rounded-none" />
              ))}
            </div>
          ) : (
            <div className={gridClass}>
              {Array.from({ length: chapterCount }, (_, i) => i + 1).map((chapter) => (
                <button
                  key={chapter}
                  type="button"
                  onClick={() => onSelectChapter(chapter)}
                  className={cn(
                    "flex aspect-square items-center justify-center text-[13px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    divisionBg
                  )}
                >
                  {chapter}
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="esboco" className="pt-2">
          <BibleBookOutline
            key={bookOrder}
            bookOrder={bookOrder}
            active={tab === "esboco"}
            onSelectSection={onSelectSection}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
