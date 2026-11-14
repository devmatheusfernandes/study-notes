"use client";

import { useCallback, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { ChevronLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import type { HighlightClick } from "@/lib/jwlibrary/draw-highlights";
import { useDocumentHighlights } from "@/hooks/use-document-highlights";
import { HighlightableHtml } from "./highlightable-html";
import { JwlibraryNoteEditorVault } from "./jwlibrary-note-editor-vault";

interface SidebarHighlightedHtmlProps {
  /** Trusted markup, rendered as-is. */
  html: string;
  /** The document being shown, or null when it isn't one a highlight can be filed under. */
  mepsDocumentId: number | null;
  className?: string;
}

/** The element that actually scrolls behind `from` — the side panel's body, or null when it's the page. */
function scrollParent(from: HTMLElement | null): HTMLElement | null {
  let node = from?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * A document opened in a side panel (a cited publication, an appendix) with the
 * user's own highlights drawn on it. A highlight that carries a note shows a
 * small coloured square in the margin; tapping it swaps the panel's content
 * for that note, with a "Voltar ao trecho" button that returns to exactly
 * where the reading was.
 *
 * Read-only on purpose: marking text happens in the full-page readers. The
 * text stays mounted underneath the note (just hidden), so going back doesn't
 * re-render the article or lose its scroll position.
 */
export function SidebarHighlightedHtml({ html, mepsDocumentId, className }: SidebarHighlightedHtmlProps) {
  const { highlights, refresh } = useDocumentHighlights(mepsDocumentId);
  const wrapRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const openHighlight = openNoteId ? highlights.find((h) => h.note?.id === openNoteId) : undefined;
  const note = openHighlight?.note ?? null;

  const handleClick = useCallback((click: HighlightClick) => {
    if (!click.highlight.note) return;
    const scroller = scrollParent(wrapRef.current);
    savedScroll.current = scroller ? scroller.scrollTop : window.scrollY;
    setEditing(false);
    setOpenNoteId(click.highlight.note.id);
  }, []);

  function back() {
    setOpenNoteId(null);
    setEditing(false);
    // Once the hidden text is visible again, put the reader back where they were.
    requestAnimationFrame(() => {
      const scroller = scrollParent(wrapRef.current);
      if (scroller) scroller.scrollTop = savedScroll.current;
      else window.scrollTo(0, savedScroll.current);
    });
  }

  const color = openHighlight && openHighlight.colorIndex !== null
    ? (JWLIBRARY_HIGHLIGHT_COLORS[openHighlight.colorIndex]?.hex ?? null)
    : null;

  return (
    <div ref={wrapRef}>
      <div className={note ? "hidden" : undefined}>
        <HighlightableHtml
          html={html}
          className={className}
          highlights={highlights}
          onHighlightClick={handleClick}
        />
      </div>

      {note && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" leftIcon={<ChevronLeft />} onClick={back} className="-ml-2">
              Voltar ao trecho
            </Button>
            <Button variant="ghost" size="sm" leftIcon={<Pencil />} onClick={() => setEditing(true)}>
              Editar
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
              aria-hidden
            />
            <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground">NOTA</span>
          </div>

          {note.title && <span className="font-heading text-[15px]">{note.title}</span>}
          {note.content && (
            <div
              className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2"
              // Plain text (imported) or Tiptap HTML (written here) — sanitized like any other untrusted HTML.
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(note.content, { USE_PROFILES: { html: true } }),
              }}
            />
          )}

          <JwlibraryNoteEditorVault
            open={editing}
            onOpenChange={(next) => !next && setEditing(false)}
            note={{
              id: note.id,
              title: note.title,
              content: note.content,
              userMarkId: openHighlight && openHighlight.colorIndex !== null ? openHighlight.id : null,
              colorIndex: openHighlight?.colorIndex ?? null,
            }}
            onSaved={() => void refresh()}
          />
        </div>
      )}
    </div>
  );
}
