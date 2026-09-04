"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  getBibleVerseRange,
  type BibleBook,
  type BibleVerseRow,
  type CrossReference,
} from "@/app/(app)/bible-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";

interface BibleReferencesPanelProps {
  open: boolean;
  onClose: () => void;
  /** e.g. "Jeremias 47:3" — the verse these references belong to. */
  currentLabel: string;
  refs: CrossReference[];
  books: BibleBook[];
  isLoading: boolean;
  onSelectReference: (bookOrder: number, chapter: number, verse: number) => void;
}

function referenceLabel(ref: CrossReference, books: BibleBook[]): string {
  const bookName = books.find((b) => b.bookOrder === ref.refBookOrder)?.book ?? "";
  const verseRange = ref.refEndVerse ? `${ref.refStartVerse}-${ref.refEndVerse}` : String(ref.refStartVerse);
  return `${bookName} ${ref.refChapter}:${verseRange}`;
}

type VerseState = BibleVerseRow[] | "loading" | "error";

/**
 * Toggleable study panel (see the header button in bible-reader.tsx) that
 * shows cross references for whatever verse was last tapped/selected — see
 * getVerseCrossReferences in app/(app)/bible-actions.ts and
 * data/cross_references.sqlite for the source. Same JwpubSidePanel shell as
 * footnotes/Bible citations inside a .jwpub publication.
 *
 * Each reference is an accordion row: tapping the label expands it in place
 * to show the actual verse text (fetched lazily via getBibleVerseRange, only
 * once per row, cached in `versesByIndex`), with a separate "Ir até o
 * capítulo" button to actually navigate there — clicking the label itself no
 * longer jumps away immediately.
 */
export function BibleReferencesPanel({
  open,
  onClose,
  currentLabel,
  refs,
  books,
  isLoading,
  onSelectReference,
}: BibleReferencesPanelProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [versesByIndex, setVersesByIndex] = useState<Record<number, VerseState>>({});

  async function toggle(index: number, ref: CrossReference) {
    if (expandedIndex === index) {
      setExpandedIndex(null);
      return;
    }
    setExpandedIndex(index);
    if (versesByIndex[index]) return;
    setVersesByIndex((prev) => ({ ...prev, [index]: "loading" }));
    const result = await getBibleVerseRange(ref.refBookOrder, ref.refChapter, ref.refStartVerse, ref.refEndVerse);
    setVersesByIndex((prev) => ({ ...prev, [index]: result.verses ?? "error" }));
  }

  return (
    <JwpubSidePanel open={open} title="Referências" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {currentLabel && (
          <span className="font-mono text-[11px] tracking-[0.04em] text-accent">{currentLabel}</span>
        )}

        {isLoading ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">carregando…</p>
        ) : refs.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            Toque num versículo pra ver as referências relacionadas.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {refs.map((ref, index) => {
              const expanded = expandedIndex === index;
              const verseState = versesByIndex[index];
              return (
                <li key={index} className="overflow-hidden rounded-2xl bg-secondary">
                  <button
                    type="button"
                    onClick={() => void toggle(index, ref)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-surface"
                  >
                    {referenceLabel(ref, books)}
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        expanded && "rotate-180"
                      )}
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-col gap-3 px-4 pb-4">
                          {verseState === undefined || verseState === "loading" ? (
                            <p className="text-[12px] text-muted-foreground">carregando…</p>
                          ) : verseState === "error" ? (
                            <p className="text-[12px] text-destructive">Não foi possível carregar o versículo.</p>
                          ) : (
                            <div className="flex flex-col gap-1 text-[13px] leading-relaxed text-foreground/90">
                              {verseState.map((v) => (
                                <p key={v.id}>
                                  {v.verse !== null && (
                                    <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">
                                      {v.verse}
                                    </span>
                                  )}
                                  {v.text ?? "texto não disponível nesta tradução"}
                                </p>
                              ))}
                            </div>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            fullWidth
                            onClick={() => onSelectReference(ref.refBookOrder, ref.refChapter, ref.refStartVerse)}
                          >
                            Ir até o capítulo
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </JwpubSidePanel>
  );
}
