"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { getBookOutline, type BibleOutlineNode } from "@/app/(app)/bible-actions";

interface BibleBookOutlineProps {
  bookOrder: number | null;
  /** Jump straight into the reading screen at that section's first verse. */
  onSelectSection: (chapter: number, verse: number | null) => void;
}

function verseRangeLabel(node: BibleOutlineNode): string {
  if (node.beginChapter === null) return "";
  const start = node.beginVerse === null ? `${node.beginChapter}` : `${node.beginChapter}:${node.beginVerse}`;
  if (node.endChapter === null) return start;
  if (node.endChapter === node.beginChapter) {
    return node.endVerse === null || node.endVerse === node.beginVerse ? start : `${start}-${node.endVerse}`;
  }
  return `${start}–${node.endChapter}:${node.endVerse ?? ""}`;
}

/**
 * A book's thematic outline, on the chapter-picker screen — the same place
 * JW Library puts it, and it needs no route of its own.
 *
 * Level-1 rows are dropped: in the source they are bare chapter-number
 * markers ("1", "2", …), which would just duplicate the chapter grid sitting
 * right above this. What's left is the real section titles (levels 2+), each
 * one a link into the chapter at that section's first verse.
 *
 * Collapsed by default. Salmos alone has ~556 section rows, so opening this
 * eagerly on every book would bury the chapter grid.
 */
export function BibleBookOutline({ bookOrder, onSelectSection }: BibleBookOutlineProps) {
  const [open, setOpen] = useState(false);
  const [nodes, setNodes] = useState<BibleOutlineNode[] | null>(null);

  // Fetched only once the section is actually expanded — the chapter grid is
  // the primary action on this screen, and most visits never open the outline.
  useEffect(() => {
    if (!open || bookOrder === null || nodes !== null) return;
    let cancelled = false;
    void getBookOutline(bookOrder).then((result) => {
      if (!cancelled) setNodes(result.nodes ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, bookOrder, nodes]);

  // Switching books must drop the previous book's outline, or expanding again
  // would show Genesis's sections under Êxodo until the refetch landed. That
  // reset is done by remounting: bible-chapter-grid.tsx keys this component on
  // `bookOrder`. An effect that called setState to clear it would be the
  // cascading-render pattern react-hooks/set-state-in-effect flags, and a key
  // says the same thing declaratively.
  const sections = (nodes ?? []).filter((node) => node.level > 1 && node.title);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-fit items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[13px] text-foreground/80 transition-colors hover:bg-surface"
      >
        Esboço do livro
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            {nodes === null ? (
              <div className="flex flex-col gap-1.5 py-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded-xl" />
                ))}
              </div>
            ) : sections.length === 0 ? (
              <p className="py-3 text-[13px] text-muted-foreground">Este livro não tem esboço.</p>
            ) : (
              <ul className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto py-1">
                {sections.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      onClick={() => onSelectSection(node.beginChapter ?? 1, node.beginVerse)}
                      // Indent by depth so the hierarchy reads at a glance —
                      // level 2 is a top-level section, 3+ are its subdivisions.
                      style={{ paddingLeft: `${(node.level - 2) * 14 + 12}px` }}
                      className="flex w-full items-baseline gap-2 rounded-xl py-1.5 pr-3 text-left text-[13px] text-foreground/85 transition-colors hover:bg-secondary"
                    >
                      <span className="flex-1">{node.title}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                        {verseRangeLabel(node)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
