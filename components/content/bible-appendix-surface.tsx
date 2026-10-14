"use client";

import { useEffect, useRef, useState } from "react";
import { getBibleAppendix, type BibleAppendix } from "@/app/(app)/bible-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";
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
}

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
          <div
            className={
              (isPage ? "text-[15px] leading-relaxed sm:text-base " : "text-[13.5px] leading-relaxed ") +
              "text-foreground/90 [&_a]:cursor-pointer [&_a]:text-accent [&_a]:underline-offset-2 [&_a:hover]:underline [&_em]:italic [&_h1]:font-heading [&_h1]:text-lg [&_header]:hidden [&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-foreground [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:p-1.5"
            }
            dangerouslySetInnerHTML={{ __html: appendix.contentHtml }}
          />
        </div>
      )}
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
