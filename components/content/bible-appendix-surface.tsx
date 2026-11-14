"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getBibleAppendix, type BibleAppendix } from "@/app/(app)/bible-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { HighlightableHtml } from "./highlightable-html";
import { SidebarHighlightedHtml } from "./sidebar-highlighted-html";
import { documentLocation, useDocumentAnnotations, type DocumentAnnotations } from "./document-annotations";
import { ReferenceContentSkeleton } from "./reference-surface-skeleton";

interface BibleAppendixContentProps {
  /** The header ("Apêndice A") and its articles (A1, A7-A…) are both valid — a header's own content IS the section's index. */
  mepsDocumentId: number;
  /** A `data-bible-ref` link inside the appendix (a citation, ~2.813 of them) was clicked. */
  onOpenBibleRef: (bookOrder: number, chapter: number, verse: number) => void;
  /** A `data-bible-appendix-ref` link (another appendix, ~627 of them — mostly a header linking to its own articles) was clicked. Replaces the currently open one. */
  onOpenAppendix: (mepsDocumentId: number) => void;
  /** Reports the loaded appendix so the host can title its own chrome with it. */
  onLoaded?: (appendix: BibleAppendix | null) => void;
  /** `page` reads at the Bible text's size; `panel` at the side panel's smaller one. */
  variant?: "page" | "panel";
  /**
   * From the full page: lets the user select text to highlight/annotate it. Without it (the side panel)
   * the appendix still shows the user's highlights, and tapping a note's square opens it in place.
   */
  annotations?: DocumentAnnotations;
}

/** Appendices are the revised NWT's own pages, filed under its symbol and Portuguese — see documentLocation. */
const APPENDIX_SYMBOL = "nwt";

/**
 * One row of `bible_appendices`, fetched and rendered — shared by the /bible
 * reader's full appendix page and the side panel the publication reader
 * still uses (jwpub-bible-surface.tsx).
 *
 * `dangerouslySetInnerHTML` is safe here for the same reason as
 * bible-study-panel.tsx's StudyHtml: this content was rewritten and run
 * through DOMPurify at SEED time (scripts/bible-study-html.mjs), before ever
 * being persisted — the database only holds trusted markup.
 */
export function BibleAppendixContent({
  mepsDocumentId,
  onOpenBibleRef,
  onOpenAppendix,
  onLoaded,
  variant = "panel",
  annotations,
}: BibleAppendixContentProps) {
  const [appendix, setAppendix] = useState<BibleAppendix | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setIsLoading(true);
        setError(null);
      }
    });
    void getBibleAppendix(mepsDocumentId).then((result) => {
      if (cancelled) return;
      setAppendix(result.appendix ?? null);
      setError(result.error ?? null);
      setIsLoading(false);
      onLoadedRef.current?.(result.appendix ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [mepsDocumentId]);

  // Delegated click for the two link kinds this HTML can carry — same
  // pattern as bible-study-panel.tsx's container listener.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;

      const appendixLink = target?.closest<HTMLElement>("[data-bible-appendix-ref]");
      if (appendixLink) {
        const id = Number(appendixLink.dataset.bibleAppendixRef);
        if (Number.isFinite(id)) {
          event.preventDefault();
          onOpenAppendix(id);
        }
        return;
      }

      const bibleLink = target?.closest<HTMLElement>("[data-bible-ref]");
      if (bibleLink) {
        const parts = (bibleLink.dataset.bibleRef ?? "").split(":").map(Number);
        if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
          event.preventDefault();
          onOpenBibleRef(parts[0], parts[1], parts[2]);
        }
      }
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [onOpenBibleRef, onOpenAppendix]);

  const isPage = variant === "page";
  const articleClass =
    (isPage ? "text-[15px] leading-relaxed sm:text-base " : "text-[13.5px] leading-relaxed ") +
    "text-foreground/90 [&_a]:cursor-pointer [&_a]:text-accent [&_a]:underline-offset-2 [&_a:hover]:underline [&_em]:italic [&_h1]:font-heading [&_h1]:text-lg [&_header]:hidden [&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-foreground [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:p-1.5";

  return (
    <div ref={contentRef}>
      {isLoading ? (
        <ReferenceContentSkeleton paragraphs={isPage ? 8 : 4} withHeading />
      ) : error || !appendix ? (
        <p className="text-[13.5px] text-muted-foreground">{error ?? "Apêndice não encontrado."}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {appendix.section === "article" && (
            <span className="font-mono text-[11px] tracking-[0.06em] text-accent">Apêndice {appendix.letter}</span>
          )}
          {appendix.section === "article" && (
            <h2 className={isPage ? "font-heading text-2xl leading-snug" : "font-heading text-lg leading-snug"}>
              {appendix.title}
            </h2>
          )}
          {annotations ? (
            <HighlightableHtml html={appendix.contentHtml} className={articleClass} {...annotations.htmlProps} />
          ) : (
            <SidebarHighlightedHtml
              html={appendix.contentHtml}
              mepsDocumentId={mepsDocumentId}
              className={articleClass}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface BibleAppendixPageProps {
  mepsDocumentId: number;
  /** The host's own page header (it owns search, back, etc.) — told the appendix's title once it has loaded. */
  renderHeader: (title: string | null) => ReactNode;
  onOpenBibleRef: (bookOrder: number, chapter: number, verse: number) => void;
  onOpenAppendix: (mepsDocumentId: number) => void;
}

/**
 * The /bible reader's full appendix page, with the highlight layer: select text
 * to highlight or annotate it, tap a note's square to read it in the side panel.
 * The panels are flex siblings of the page column (that is what a side panel is),
 * so the layout lives here rather than in the host.
 */
export function BibleAppendixPage({ mepsDocumentId, renderHeader, onOpenBibleRef, onOpenAppendix }: BibleAppendixPageProps) {
  const [title, setTitle] = useState<string | null>(null);
  const annotations = useDocumentAnnotations(
    documentLocation(APPENDIX_SYMBOL, mepsDocumentId),
    title ?? "Apêndice"
  );

  return (
    <div className="flex min-h-dvh w-full flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {renderHeader(title)}
        <div className="flex-1 px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <BibleAppendixContent
              key={mepsDocumentId}
              variant="page"
              mepsDocumentId={mepsDocumentId}
              annotations={annotations}
              onLoaded={(appendix) =>
                setTitle(appendix ? (appendix.section === "header" ? appendix.title : `Apêndice ${appendix.letter}`) : null)
              }
              onOpenAppendix={onOpenAppendix}
              onOpenBibleRef={onOpenBibleRef}
            />
          </div>
        </div>
      </div>
      {annotations.panels}
    </div>
  );
}

interface BibleAppendixSurfaceProps {
  /** `null` closes the panel. */
  mepsDocumentId: number | null;
  onClose: () => void;
  onOpenBibleRef: (bookOrder: number, chapter: number, verse: number) => void;
  onOpenAppendix: (mepsDocumentId: number) => void;
}

/**
 * Side-panel form of an appendix — same `JwpubSidePanel` shell as footnotes
 * and cross references (Vault on mobile, content-pushing panel on desktop).
 * The /bible reader opens appendices as a full page instead; this stays for
 * the publication reader, where an appendix is read alongside a chapter.
 *
 * No back-stack: clicking a link inside an appendix replaces the one showing.
 */
export function BibleAppendixSurface({
  mepsDocumentId,
  onClose,
  onOpenBibleRef,
  onOpenAppendix,
}: BibleAppendixSurfaceProps) {
  const [loaded, setLoaded] = useState<BibleAppendix | null>(null);

  return (
    <JwpubSidePanel
      open={mepsDocumentId !== null}
      title={loaded?.section === "header" ? loaded.title : "Apêndice"}
      onClose={onClose}
      width={460}
    >
      {mepsDocumentId !== null && (
        <BibleAppendixContent
          key={mepsDocumentId}
          mepsDocumentId={mepsDocumentId}
          onOpenBibleRef={onOpenBibleRef}
          onOpenAppendix={onOpenAppendix}
          onLoaded={setLoaded}
        />
      )}
    </JwpubSidePanel>
  );
}
