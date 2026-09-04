"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getBookOutline, type BibleOutlineNode } from "@/app/(app)/bible-actions";

interface BibleBookOutlineProps {
  bookOrder: number | null;
  /** Only fetches once its tab is actually shown — the chapter grid is the primary action on this screen and most visits never open this. */
  active: boolean;
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
 * A book's thematic outline, as the second tab of the chapter picker — the
 * same place JW Library puts it, and it needs no route of its own.
 *
 * Level-1 rows are dropped: in the source they are bare chapter-number
 * markers ("1", "2", …), which would just duplicate the chapter grid in the
 * other tab. What's left is the real section titles (levels 2+), each one a
 * link into the chapter at that section's first verse.
 *
 * Switching books resets this by remounting — bible-chapter-grid.tsx keys the
 * component on `bookOrder`. An effect calling setState to clear it would be
 * the cascading-render pattern react-hooks/set-state-in-effect flags, and a
 * key says the same thing declaratively.
 */
export function BibleBookOutline({ bookOrder, active, onSelectSection }: BibleBookOutlineProps) {
  const [nodes, setNodes] = useState<BibleOutlineNode[] | null>(null);

  useEffect(() => {
    if (!active || bookOrder === null || nodes !== null) return;
    let cancelled = false;
    void getBookOutline(bookOrder).then((result) => {
      if (!cancelled) setNodes(result.nodes ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [active, bookOrder, nodes]);

  const sections = (nodes ?? []).filter((node) => node.level > 1 && node.title);

  if (nodes === null) {
    return (
      <div className="flex flex-col gap-1.5 py-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (sections.length === 0) {
    return <p className="py-6 text-[13px] text-muted-foreground">Este livro não tem esboço.</p>;
  }

  return (
    <ul className="flex flex-col gap-0.5 py-1">
      {sections.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            onClick={() => onSelectSection(node.beginChapter ?? 1, node.beginVerse)}
            // Indent by depth so the hierarchy reads at a glance — level 2 is a
            // top-level section, 3+ are its subdivisions.
            style={{ paddingLeft: `${(node.level - 2) * 14 + 12}px` }}
            className="flex w-full items-baseline gap-3 rounded-xl py-1.5 pr-3 text-left text-[13px] text-foreground/85 transition-colors hover:bg-secondary"
          >
            <span className="min-w-0 flex-1">{node.title}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
              {verseRangeLabel(node)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
