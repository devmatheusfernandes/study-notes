"use client";

import { useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  BibleBook,
  BibleFootnote,
  BibleStudyNote,
  CrossReference,
  CrossReferenceSource,
} from "@/app/(app)/bible-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { BibleReferencesList } from "./bible-references-panel";

export type BibleStudyTab = "referencias" | "notas" | "rodape";

interface BibleStudyPanelProps {
  open: boolean;
  onClose: () => void;
  tab: BibleStudyTab;
  onTabChange: (tab: BibleStudyTab) => void;

  /** e.g. "Mateus 5:3" — whichever verse was last tapped. */
  currentLabel: string;
  /** `null` before the reader has a verse selected. */
  selectedVerse: number | null;

  refs: CrossReference[];
  refsLoading: boolean;
  refsSource: CrossReferenceSource;
  onChangeRefsSource: (source: CrossReferenceSource) => void;
  books: BibleBook[];
  onSelectReference: (bookOrder: number, chapter: number, verse: number) => void;

  /** Already narrowed to the selected verse by the reader. */
  footnotes: BibleFootnote[];
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
      className="jwpub-study-content text-[13.5px] leading-relaxed text-foreground/90 [&_a]:cursor-pointer [&_a]:text-accent [&_a]:underline-offset-2 [&_a:hover]:underline [&_em]:italic [&_strong]:font-semibold [&_strong]:text-foreground [&_p]:my-2"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * The reader's study surface: cross references, study notes and footnotes for
 * the verse the reader is currently looking at, behind one header toggle
 * instead of three. Same `JwpubSidePanel` shell as the .jwpub reader's
 * footnotes — Vault sheet on mobile, content-pushing panel on desktop, never
 * a modal (see CLAUDE.md).
 *
 * Study notes only exist for Mateus–Filêmon (minus Tito) and footnotes are
 * per-verse, so empty tabs are the normal case for most of the Bible, not an
 * error state.
 */
export function BibleStudyPanel({
  open,
  onClose,
  tab,
  onTabChange,
  currentLabel,
  selectedVerse,
  refs,
  refsLoading,
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

  const hasVerse = selectedVerse !== null;

  return (
    <JwpubSidePanel open={open} title="Estudo" onClose={onClose} width={420}>
      <div ref={contentRef}>
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as BibleStudyTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="referencias">Referências</TabsTrigger>
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

          <TabsContent value="referencias" className="pt-3">
            <BibleReferencesList
              currentLabel={currentLabel}
              refs={refs}
              books={books}
              isLoading={refsLoading}
              source={refsSource}
              onChangeSource={onChangeRefsSource}
              onSelectReference={onSelectReference}
            />
          </TabsContent>

          <TabsContent value="notas" className="pt-3">
            {currentLabel && (
              <span className="font-mono text-[11px] tracking-[0.04em] text-accent">{currentLabel}</span>
            )}
            {studyLoading ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">carregando…</p>
            ) : !hasVerse ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                Toque num versículo pra ver as notas de estudo.
              </p>
            ) : studyNotes.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                Este versículo não tem notas de estudo.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {studyNotes.map((note) => (
                  <div key={note.id} className="rounded-2xl bg-secondary px-4 py-3">
                    <StudyHtml html={note.contentHtml} />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rodape" className="pt-3">
            {currentLabel && (
              <span className="font-mono text-[11px] tracking-[0.04em] text-accent">{currentLabel}</span>
            )}
            {studyLoading ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">carregando…</p>
            ) : !hasVerse ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                Toque num versículo pra ver as notas de rodapé.
              </p>
            ) : footnotes.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                Este versículo não tem notas de rodapé.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {footnotes.map((footnote, index) => (
                  <li key={footnote.id} className="flex gap-2.5 rounded-2xl bg-secondary px-4 py-3">
                    {/* Numbered by position within the verse — the stored
                        `index` is sequential per BOOK (it mirrors the source's
                        data-fnid), so showing it raw would print "389" next to
                        the last footnote of Genesis. */}
                    <span className="mt-0.5 font-mono text-[10px] text-accent">{index + 1}</span>
                    <StudyHtml html={footnote.contentHtml} />
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </JwpubSidePanel>
  );
}
