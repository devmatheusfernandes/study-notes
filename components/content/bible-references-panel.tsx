"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  getBibleVerseRange,
  getBibleVerseByReference,
  type BibleBook,
  type BibleVerseRow,
  type CrossReference,
  type CrossReferenceSource,
} from "@/app/(app)/bible-actions";

interface BibleReferencesListProps {
  refs: CrossReference[];
  books: BibleBook[];
  onSelectReference: (bookOrder: number, chapter: number, verse: number) => void;
  /** Disambiguates the lazy-load cache when several lists are on screen at once (the whole-chapter view renders one per verse). */
  cacheKeyPrefix?: string;
}

function referenceLabel(ref: CrossReference, books: BibleBook[]): string {
  const bookName = books.find((b) => b.bookOrder === ref.refBookOrder)?.book ?? "";
  // A null start verse means the target is a Psalm superscription, which has
  // no verse number of its own — labeling it "51:null" or "51:0" would be
  // worse than naming what it actually is.
  if (ref.refStartVerse === null) return `${bookName} ${ref.refChapter} (sobrescrito)`;
  const verseRange = ref.refEndVerse ? `${ref.refStartVerse}-${ref.refEndVerse}` : String(ref.refStartVerse);
  return `${bookName} ${ref.refChapter}:${verseRange}`;
}

type VerseState = BibleVerseRow[] | "loading" | "error";

/**
 * Groups references by their marginal letter.
 *
 * `marker` is a chapter-wide position counter in the source, not a per-verse
 * index — Genesis 1:1's single marker is 1 while 1:2's are 2, 3 and 4. So the
 * displayed letter is the *rank* of the distinct markers within this verse,
 * which is what actually reads as "a, b, c" next to the text. `extended`
 * references have no marker at all and fall into one unlabeled group.
 */
function groupByMarker(refs: CrossReference[]): { letter: string | null; refs: CrossReference[] }[] {
  const groups = new Map<number | null, CrossReference[]>();
  for (const ref of refs) {
    const existing = groups.get(ref.marker);
    if (existing) existing.push(ref);
    else groups.set(ref.marker, [ref]);
  }

  const entries = [...groups.entries()];
  const lettered = entries.length > 1 && entries.every(([marker]) => marker !== null);

  return entries.map(([, groupRefs], index) => ({
    letter: lettered ? String.fromCharCode(97 + index) : null,
    refs: groupRefs,
  }));
}

export const CROSS_REFERENCE_SOURCE_LABELS: Record<CrossReferenceSource, string> = {
  nwt: "Marginais",
  extended: "Estendidas",
};

/**
 * A list of cross references — see getVerseCrossReferences /
 * getChapterCrossReferences in app/(app)/bible-actions.ts. Rendered inside
 * BibleStudyPanel, which owns the shell, the scope label and the source
 * toggle; this component is only the list, so the panel can stack several of
 * them (one per verse) in its whole-chapter view.
 *
 * Each reference is an accordion row: tapping the label expands it in place
 * to show the actual verse text (fetched lazily, only once per row, cached in
 * `versesByKey`), with a separate "Ir até o capítulo" button to navigate —
 * clicking the label itself deliberately doesn't jump away.
 */
export function BibleReferencesList({
  refs,
  books,
  onSelectReference,
  cacheKeyPrefix = "",
}: BibleReferencesListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [versesByKey, setVersesByKey] = useState<Record<string, VerseState>>({});

  async function toggle(key: string, ref: CrossReference) {
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    if (versesByKey[key]) return;
    setVersesByKey((prev) => ({ ...prev, [key]: "loading" }));

    // A superscription target has no verse number, so the range query can't
    // address it — getBibleVerseByReference's `verse: null` branch is the one
    // that looks up `is_superscription` instead.
    const result =
      ref.refStartVerse === null
        ? await getBibleVerseByReference(ref.refBookOrder, ref.refChapter, null).then((r) => ({
            verses: r.verse ? [r.verse] : undefined,
          }))
        : await getBibleVerseRange(ref.refBookOrder, ref.refChapter, ref.refStartVerse, ref.refEndVerse);

    setVersesByKey((prev) => ({ ...prev, [key]: result.verses ?? "error" }));
  }

  const groups = groupByMarker(refs);

  return (
        <ul className="flex flex-col gap-1.5">
          {groups.map((group, groupIndex) =>
            group.refs.map((ref, index) => {
              const key = `${cacheKeyPrefix}${groupIndex}-${index}`;
              const expanded = expandedKey === key;
              const verseState = versesByKey[key];
              return (
                <li key={key} className="overflow-hidden rounded-2xl bg-secondary">
                  <button
                    type="button"
                    onClick={() => void toggle(key, ref)}
                    aria-expanded={expanded}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-surface"
                  >
                    {group.letter && index === 0 && (
                      <span className="font-mono text-[10px] text-accent">{group.letter}</span>
                    )}
                    <span className={cn("flex-1", group.letter && index > 0 && "pl-[13px]")}>
                      {referenceLabel(ref, books)}
                    </span>
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
                                // whitespace-pre-line: verse text carries real
                                // `\n` for poetry — see bible-chapter-view.tsx.
                                <p key={v.id} className="whitespace-pre-line">
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
                            onClick={() =>
                              onSelectReference(ref.refBookOrder, ref.refChapter, ref.refStartVerse ?? 1)
                            }
                          >
                            Ir até o capítulo
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })
          )}
        </ul>
  );
}
