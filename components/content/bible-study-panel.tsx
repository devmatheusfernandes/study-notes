"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  BibleBook,
  BibleFootnote,
  BibleStudyNote,
  CrossReference,
  CrossReferenceSource,
} from "@/app/(app)/bible-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { BibleReferencesList, CROSS_REFERENCE_SOURCE_LABELS } from "./bible-references-panel";

export type BibleStudyTab = "referencias" | "notas" | "rodape";

/** Whatever verse each item belongs to — needed for the whole-chapter view's headings. */
type WithVerse<T> = T & { verse: number | null };

interface BibleStudyPanelProps {
  open: boolean;
  onClose: () => void;
  tab: BibleStudyTab;
  onTabChange: (tab: BibleStudyTab) => void;

  bookName: string;
  chapter: number;
  /** `null` means "nothing tapped yet" — the panel then shows the whole chapter instead of an empty state. */
  selectedVerse: number | null;
  /** Clears the verse filter and goes back to the whole-chapter view. */
  onClearVerse: () => void;
  /** Narrows the panel to one verse — the whole-chapter view's headings. */
  onSelectVerse: (verse: number) => void;

  refs: WithVerse<CrossReference>[];
  refsLoading: boolean;
  refsTruncated: boolean;
  refsSource: CrossReferenceSource;
  onChangeRefsSource: (source: CrossReferenceSource) => void;
  books: BibleBook[];
  onSelectReference: (bookOrder: number, chapter: number, verse: number) => void;

  footnotes: WithVerse<BibleFootnote>[];
  studyNotes: BibleStudyNote[];
  studyLoading: boolean;

  /** A `data-bible-ref` link inside a study note or footnote was clicked. */
  onOpenBibleRef: (bookOrder: number, chapter: number, verse: number) => void;
}

/**
 * Renders content_html straight from the database.
 *
 * `dangerouslySetInnerHTML` is safe here for the same reason it is in the
 * .jwpub reader: this HTML was rewritten (jwpub:// → inert `data-*`) and run
 * through DOMPurify at SEED time, before it was ever persisted — see
 * scripts/bible-study-html.mjs. The database only holds trusted markup, so
 * this component is a plain renderer and never has to sanitize at read time.
 */
function StudyHtml({ html }: { html: string }) {
  return (
    <div
      className="text-[13.5px] leading-relaxed text-foreground/90 [&_a]:cursor-pointer [&_a]:text-accent [&_a]:underline-offset-2 [&_a:hover]:underline [&_em]:italic [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-foreground"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Groups items by verse number, preserving the order they arrived in. */
function groupByVerse<T extends { verse: number | null }>(items: T[]): { verse: number | null; items: T[] }[] {
  const groups: { verse: number | null; items: T[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.verse === item.verse) last.items.push(item);
    else groups.push({ verse: item.verse, items: [item] });
  }
  return groups;
}

/** Clickable heading above each verse's block in the whole-chapter view. */
function VerseHeading({ verse, onClick }: { verse: number | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="sticky top-0 z-10 -mx-1 flex w-[calc(100%+0.5rem)] items-baseline gap-1.5 bg-[#161413] px-1 py-1.5 text-left font-mono text-[11px] tracking-[0.04em] text-accent transition-colors hover:text-foreground"
    >
      {verse === null ? "sobrescrito" : `versículo ${verse}`}
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/**
 * The reader's study surface: cross references, study notes and footnotes,
 * behind one header toggle instead of three. Same `JwpubSidePanel` shell as
 * the .jwpub reader's footnotes — Vault sheet on mobile, content-pushing
 * panel on desktop, never a modal (see CLAUDE.md).
 *
 * With no verse tapped, every tab shows the WHOLE chapter grouped by verse,
 * rather than an "escolha um versículo" placeholder — opening the panel is
 * then immediately useful, and each verse heading narrows to that verse.
 *
 * Study notes only exist for Mateus–Filêmon (minus Tito), so an empty Notas
 * tab is the normal case for most of the Bible, not an error.
 */
export function BibleStudyPanel({
  open,
  onClose,
  tab,
  onTabChange,
  bookName,
  chapter,
  selectedVerse,
  onClearVerse,
  onSelectVerse,
  refs,
  refsLoading,
  refsTruncated,
  refsSource,
  onChangeRefsSource,
  books,
  onSelectReference,
  footnotes,
  studyNotes,
  studyLoading,
  onOpenBibleRef,
}: BibleStudyPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Delegated click for the `data-bible-ref="book:chapter:verse"` links the
  // seed left inside study notes and footnotes. One listener on the container
  // rather than rehydrating every <a> into a React component — the HTML is
  // injected as a string, so there are no React nodes to attach to.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    function handleClick(event: MouseEvent) {
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-bible-ref]");
      if (!anchor) return;
      const parts = (anchor.dataset.bibleRef ?? "").split(":").map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return;
      event.preventDefault();
      onOpenBibleRef(parts[0], parts[1], parts[2]);
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [onOpenBibleRef]);

  const whole = selectedVerse === null;
  const scopeLabel = whole ? `${bookName} ${chapter}` : `${bookName} ${chapter}:${selectedVerse}`;

  const refGroups = useMemo(() => groupByVerse(refs), [refs]);
  const footnoteGroups = useMemo(() => groupByVerse(footnotes), [footnotes]);
  const studyNoteGroups = useMemo(() => groupByVerse(studyNotes), [studyNotes]);

  // A superscription has no verse number, so its heading is a label, not a
  // filter target — there is nothing to narrow to.
  const narrow = (verse: number | null) => () => {
    if (verse !== null) onSelectVerse(verse);
  };

  return (
    <JwpubSidePanel open={open} title="Estudo" onClose={onClose} width={420}>
      <div ref={contentRef} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] tracking-[0.04em] text-accent">{scopeLabel}</span>
          {!whole && (
            <button
              type="button"
              onClick={onClearVerse}
              className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              ver capítulo
            </button>
          )}
        </div>

        <Tabs value={tab} onValueChange={(value) => onTabChange(value as BibleStudyTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="referencias">
              Refs
              {refs.length > 0 && <span className="ml-1 font-mono text-[10px] text-accent">{refs.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="notas">
              Notas
              {studyNotes.length > 0 && (
                <span className="ml-1 font-mono text-[10px] text-accent">{studyNotes.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="rodape">
              Rodapé
              {footnotes.length > 0 && (
                <span className="ml-1 font-mono text-[10px] text-accent">{footnotes.length}</span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="referencias" className="flex flex-col gap-3">
            <div className="flex items-center gap-0.5 self-start rounded-full bg-secondary p-0.5">
              {(Object.keys(CROSS_REFERENCE_SOURCE_LABELS) as CrossReferenceSource[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onChangeRefsSource(option)}
                  aria-pressed={refsSource === option}
                  className={cn(
                    "rounded-full px-2.5 py-1 font-mono text-[10px] tracking-[0.04em] transition-colors",
                    refsSource === option
                      ? "bg-primary/[0.18] text-accent"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {CROSS_REFERENCE_SOURCE_LABELS[option]}
                </button>
              ))}
            </div>

            {refsTruncated && (
              <p className="text-[11.5px] leading-snug text-muted-foreground">
                Capítulo com muitas referências — mostrando as primeiras {refs.length}. Toque num versículo
                para ver todas as dele.
              </p>
            )}

            {refsLoading ? (
              <EmptyHint>carregando…</EmptyHint>
            ) : refs.length === 0 ? (
              <EmptyHint>
                {whole ? "Este capítulo não tem referências." : "Este versículo não tem referências."}
              </EmptyHint>
            ) : whole ? (
              <div className="flex flex-col gap-3">
                {refGroups.map((group) => (
                  <div key={group.verse ?? "sup"} className="flex flex-col gap-1.5">
                    <VerseHeading verse={group.verse} onClick={narrow(group.verse)} />
                    <BibleReferencesList
                      refs={group.items}
                      books={books}
                      onSelectReference={onSelectReference}
                      cacheKeyPrefix={`v${group.verse}-`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <BibleReferencesList refs={refs} books={books} onSelectReference={onSelectReference} />
            )}
          </TabsContent>

          <TabsContent value="notas">
            {studyLoading ? (
              <EmptyHint>carregando…</EmptyHint>
            ) : studyNotes.length === 0 ? (
              <EmptyHint>
                {whole
                  ? "Este capítulo não tem notas de estudo."
                  : "Este versículo não tem notas de estudo."}
              </EmptyHint>
            ) : (
              <div className="flex flex-col gap-3">
                {studyNoteGroups.map((group) => (
                  <div key={group.verse ?? "sup"} className="flex flex-col gap-1.5">
                    {whole && <VerseHeading verse={group.verse} onClick={narrow(group.verse)} />}
                    {group.items.map((note) => (
                      <div key={note.id} className="rounded-2xl bg-secondary px-4 py-3">
                        <StudyHtml html={note.contentHtml} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rodape">
            {studyLoading ? (
              <EmptyHint>carregando…</EmptyHint>
            ) : footnotes.length === 0 ? (
              <EmptyHint>
                {whole ? "Este capítulo não tem notas de rodapé." : "Este versículo não tem notas de rodapé."}
              </EmptyHint>
            ) : (
              <div className="flex flex-col gap-3">
                {footnoteGroups.map((group) => (
                  <div key={group.verse ?? "sup"} className="flex flex-col gap-1.5">
                    {whole && <VerseHeading verse={group.verse} onClick={narrow(group.verse)} />}
                    <ul className="flex flex-col gap-1.5">
                      {group.items.map((footnote, index) => (
                        <li key={footnote.id} className="flex gap-2.5 rounded-2xl bg-secondary px-4 py-3">
                          {/* Numbered by position within the verse — the stored
                              `index` is sequential per BOOK (it mirrors the
                              source's data-fnid), so showing it raw would print
                              "389" next to the last footnote of Genesis. */}
                          <span className="mt-0.5 font-mono text-[10px] text-accent">{index + 1}</span>
                          <StudyHtml html={footnote.contentHtml} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </JwpubSidePanel>
  );
}
