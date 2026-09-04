"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { getBibleAppendix, type BibleAppendix } from "@/app/(app)/bible-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";

interface BibleAppendixSurfaceProps {
  /** `null` closes the panel. The header ("Apêndice A") and its articles (A1, A7-A…) are both valid — a header's own content IS the section's index. */
  mepsDocumentId: number | null;
  onClose: () => void;
  /** A `data-bible-ref` link inside the appendix (a citation, ~2.813 of them) was clicked. */
  onOpenBibleRef: (bookOrder: number, chapter: number, verse: number) => void;
  /** A `data-bible-appendix-ref` link (another appendix, ~627 of them — mostly a header linking to its own articles) was clicked. Replaces the currently open one. */
  onOpenAppendix: (mepsDocumentId: number) => void;
}

/**
 * Reader for one row of `bible_appendices` — same `JwpubSidePanel` shell as
 * footnotes and cross references (Vault on mobile, content-pushing panel on
 * desktop), because an appendix is fundamentally the same kind of "open this
 * alongside what I'm reading" surface.
 *
 * `dangerouslySetInnerHTML` is safe here for the same reason as
 * bible-study-panel.tsx's StudyHtml: this content was rewritten and run
 * through DOMPurify at SEED time (scripts/bible-study-html.mjs), before ever
 * being persisted — the database only holds trusted markup.
 *
 * No back-stack: clicking a link inside an appendix replaces the one showing,
 * same as "Ir até o capítulo" in the references list. C4 alone is 264 KB of
 * HTML (a concordance table), so this is already a long-scroll reading
 * surface, not a quick popover — a history stack can be added if losing the
 * previous article turns out to matter in practice.
 */
export function BibleAppendixSurface({
  mepsDocumentId,
  onClose,
  onOpenBibleRef,
  onOpenAppendix,
}: BibleAppendixSurfaceProps) {
  const [appendix, setAppendix] = useState<BibleAppendix | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mepsDocumentId === null) return;
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

  return (
    <JwpubSidePanel
      open={mepsDocumentId !== null}
      title={appendix?.section === "header" ? appendix.title : "Apêndice"}
      onClose={onClose}
      width={460}
    >
      <div ref={contentRef}>
        {isLoading ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <motion.span
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
              className="size-1.5 rounded-full bg-accent"
            />
            carregando…
          </div>
        ) : error || !appendix ? (
          <p className="text-[13.5px] text-muted-foreground">{error ?? "Apêndice não encontrado."}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {appendix.section === "article" && (
              <span className="font-mono text-[11px] tracking-[0.06em] text-accent">
                Apêndice {appendix.letter}
              </span>
            )}
            {appendix.section === "article" && (
              <h2 className="font-heading text-lg leading-snug">{appendix.title}</h2>
            )}
            <div
              className="text-[13.5px] leading-relaxed text-foreground/90 [&_a]:cursor-pointer [&_a]:text-accent [&_a]:underline-offset-2 [&_a:hover]:underline [&_em]:italic [&_h1]:font-heading [&_h1]:text-lg [&_header]:hidden [&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-foreground [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:p-1.5"
              dangerouslySetInnerHTML={{ __html: appendix.contentHtml }}
            />
          </div>
        )}
      </div>
    </JwpubSidePanel>
  );
}
