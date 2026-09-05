"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { motion } from "framer-motion";
import type { BibleVerseRow } from "@/app/(app)/bible-actions";
import type { BibleVerseHighlight } from "@/app/(app)/jwlibrary-actions";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import { wrapTokenRange, unwrapHighlightMarks } from "@/lib/jwlibrary/paragraph-tokens";
import { JwpubSidePanel } from "./jwpub-side-panel";

interface JwpubBibleSurfaceProps {
  open: boolean;
  verses: BibleVerseRow[] | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  /** Imported JW Library highlights/notes for the chapter(s) these verses belong to — see getBibleChapterHighlights in jwlibrary-actions.ts. Highlights for a verse not in `verses` are simply skipped (no matching `[data-verse]` element to draw on). */
  highlights?: BibleVerseHighlight[];
}

function reference(verses: BibleVerseRow[]): string {
  const first = verses.find((v) => !v.isSuperscription) ?? verses[0];
  const last = verses[verses.length - 1];
  if (!first) return "";
  if (first.chapter === last.chapter && first.verse === last.verse) {
    return `${first.book} ${first.chapter}:${first.verse ?? ""}`;
  }
  if (first.chapter === last.chapter) {
    return `${first.book} ${first.chapter}:${first.verse ?? ""}-${last.verse ?? ""}`;
  }
  return `${first.book} ${first.chapter}:${first.verse ?? ""}–${last.chapter}:${last.verse ?? ""}`;
}

function Body({
  verses,
  isLoading,
  error,
  highlights,
}: {
  verses: BibleVerseRow[] | null;
  isLoading: boolean;
  error: string | null;
  highlights: BibleVerseHighlight[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Which highlight's note is expanded inline right now — clicking its
  // margin marker again (or a different one) toggles it. Read-only display,
  // no separate panel/vault: the whole point is to view the note without
  // leaving this sidebar.
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);

  // Draws highlight marks + a margin marker per note, same mechanics as
  // BibleChapterView's identical effect — but read-only here (no selection
  // popup, no creating new highlights from this surface).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    unwrapHighlightMarks(container);
    if (highlights.length === 0) return;

    for (const highlight of highlights) {
      const el = container.querySelector<HTMLElement>(`[data-verse="${highlight.verse}"]`);
      if (!el) continue;
      const colorHex = JWLIBRARY_HIGHLIGHT_COLORS[highlight.colorIndex]?.hex ?? JWLIBRARY_HIGHLIGHT_COLORS[1].hex;
      const mark = wrapTokenRange(el, highlight.startToken, highlight.endToken, colorHex, highlight.id, highlight.note?.id);

      if (highlight.note && mark) {
        el.style.position = "relative";
        const marker = document.createElement("span");
        marker.className = "jwlibrary-note-marker";
        marker.dataset.jwlibraryNoteId = highlight.note.id;
        Object.assign(marker.style, {
          position: "absolute",
          left: "-14px",
          top: `${mark.offsetTop}px`,
          width: "8px",
          height: "8px",
          borderRadius: "2px",
          backgroundColor: colorHex,
          cursor: "pointer",
        });
        el.insertBefore(marker, el.firstChild);
      }
    }
  }, [verses, highlights]);

  // Clicking a note marker (or the highlighted span it belongs to) toggles
  // that note's inline preview open/closed.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(event: MouseEvent) {
      const el = event.target as HTMLElement | null;
      const noteMark = el?.closest<HTMLElement>("[data-jwlibrary-note-id]");
      const noteId = noteMark?.dataset.jwlibraryNoteId;
      if (!noteId) return;
      setExpandedNoteId((prev) => (prev === noteId ? null : noteId));
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          className="size-1.5 rounded-full bg-accent"
        />
        carregando…
      </div>
    );
  }

  if (error || !verses || verses.length === 0) {
    return (
      <p className="text-[13.5px] text-muted-foreground">
        {error ?? "Referência bíblica não encontrada."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-[11px] tracking-[0.06em] text-accent">
        {reference(verses)}
      </span>
      <div ref={containerRef} className="text-[14.5px] leading-relaxed text-foreground/90">
        {/* whitespace-pre-line: see the comment in bible-chapter-view.tsx — verse text carries real `\n` for poetry. */}
        {verses.map((v) => {
          if (v.isSuperscription) {
            return (
              <p key={v.id} className="my-2 whitespace-pre-line italic text-muted-foreground">
                {v.text ?? ""}
              </p>
            );
          }

          const notesHere = highlights.filter(
            (h) => h.verse === v.verse && h.note && h.note.id === expandedNoteId
          );

          return (
            <div key={v.id}>
              <p data-verse={v.verse ?? undefined} className="relative my-2">
                <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{v.verse}</span>
                {v.text ?? (
                  <span className="italic text-muted-foreground">
                    texto não disponível nesta tradução
                  </span>
                )}
              </p>
              {notesHere.map((h) => (
                <div
                  key={h.note!.id}
                  className="my-1.5 ml-1 flex flex-col gap-1 rounded-xl border-l-2 border-accent/50 bg-secondary/50 px-3 py-2.5"
                >
                  {h.note!.title && <span className="font-heading text-[13px]">{h.note!.title}</span>}
                  {h.note!.content && (
                    <div
                      className="text-[12.5px] leading-relaxed text-foreground/90 [&_p]:my-1"
                      // Same trust level as JwlibraryHighlightNotePanel's own
                      // note rendering — plain text (imported) or Tiptap HTML.
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(h.note!.content, { USE_PROFILES: { html: true } }),
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Same shell as footnotes: Vault sheet on mobile, a content-pushing panel on desktop. */
export function JwpubBibleSurface({ open, verses, isLoading, error, onClose, highlights = [] }: JwpubBibleSurfaceProps) {
  return (
    <JwpubSidePanel open={open} title="Referência bíblica" onClose={onClose}>
      <Body verses={verses} isLoading={isLoading} error={error} highlights={highlights} />
    </JwpubSidePanel>
  );
}
