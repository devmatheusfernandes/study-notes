"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NotebookPen } from "lucide-react";
import type { ParagraphHighlight } from "@/app/(app)/jwlibrary-actions";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import { HighlightSwatch } from "@/components/ui/highlight-swatch";
import { getTokenRangeForSelection } from "@/lib/jwlibrary/paragraph-tokens";
import { drawParagraphHighlights, highlightFromClick, type HighlightClick } from "@/lib/jwlibrary/draw-highlights";

interface HighlightableHtmlProps {
  /** Trusted markup (already rewritten and sanitized at import/seed time) — rendered as-is. */
  html: string;
  className?: string;
  highlights: ParagraphHighlight[];
  /** A drawn highlight or note square was clicked. */
  onHighlightClick?: (click: HighlightClick) => void;
  /**
   * Set to let the user select text and tap a colour (or the note icon). Left
   * out for a read-only surface, such as a reference opened in a side panel.
   */
  onCreateHighlight?: (pid: string, startToken: number, endToken: number, colorIndex: number) => void;
  onPickSpan?: (pid: string, startToken: number, endToken: number, selectedText: string) => void;
}

/** Roughly half the pill's rendered width, used only to keep it inside the viewport. */
const POPUP_HALF_WIDTH = 110;
/** `selectionchange` fires continuously while the handles are still being dragged — wait for the selection to settle. */
const SELECTION_PROMPT_DELAY_MS = 350;

/**
 * An article rendered as plain HTML that can still carry the user's own marks.
 * The appendices, Perspicaz and the Guia de Pesquisa are not `.jwpub` chapters
 * the reader owns, but their paragraphs carry the archive's `data-pid` just the
 * same — which is all a highlight's BlockRange needs to find its text again.
 *
 * Same behaviour as JwpubChapterView's own highlight layer (marks, a coloured
 * square in the margin for every note, a colour pill under a selection), kept
 * separate because that view is bound to a publication the user imported.
 */
export function HighlightableHtml({
  html,
  className,
  highlights,
  onHighlightClick,
  onCreateHighlight,
  onPickSpan,
}: HighlightableHtmlProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canSelect = Boolean(onCreateHighlight || onPickSpan);
  // A stable object, so a re-render never rewrites the HTML (which would wipe the marks and the selection).
  const markup = useMemo(() => ({ __html: html }), [html]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) drawParagraphHighlights(container, highlights);
  }, [html, highlights]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onHighlightClick) return;
    function handleClick(event: MouseEvent) {
      // A highlight that has only just been created still carries the id the
      // outbox will replay it under; it is real, so no special-casing is needed.
      const click = highlightFromClick(event.target as HTMLElement | null, highlights);
      if (click) onHighlightClick?.(click);
    }
    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [highlights, onHighlightClick]);

  // `left`/`top` are relative to the wrapper, not the viewport: inside a Vault (which is
  // transformed) a `position: fixed` pill would land somewhere else entirely.
  const [prompt, setPrompt] = useState<{ left: number; top: number; pid: string; range: Range } | null>(null);

  useEffect(() => {
    if (!canSelect) return;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;

    function handleSelectionChange() {
      if (delayTimer) clearTimeout(delayTimer);
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setPrompt(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const anchorEl = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element);
      const paragraphEl = anchorEl?.closest<HTMLElement>("[data-pid]");
      if (!paragraphEl || !container.contains(paragraphEl) || !paragraphEl.dataset.pid) {
        setPrompt(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPrompt(null);
        return;
      }

      const pid = paragraphEl.dataset.pid;
      const cloned = range.cloneRange();
      delayTimer = setTimeout(() => {
        const box = wrapperRef.current?.getBoundingClientRect();
        if (!box) return;
        const half = Math.min(POPUP_HALF_WIDTH, box.width / 2);
        setPrompt({
          left: Math.min(Math.max(rect.left + rect.width / 2 - box.left, half), box.width - half),
          top: Math.min(rect.bottom + 10, window.innerHeight - 52) - box.top,
          pid,
          range: cloned,
        });
      }, SELECTION_PROMPT_DELAY_MS);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (delayTimer) clearTimeout(delayTimer);
    };
  }, [canSelect]);

  const confirm = useCallback(
    (colorIndex?: number) => {
      if (!prompt) return;
      const paragraphEl = containerRef.current?.querySelector<HTMLElement>(`[data-pid="${CSS.escape(prompt.pid)}"]`);
      if (!paragraphEl) return;
      const tokenRange = getTokenRangeForSelection(paragraphEl, prompt.range);
      const selectedText = prompt.range.toString();
      window.getSelection()?.removeAllRanges();
      setPrompt(null);
      if (!tokenRange) return;
      if (colorIndex !== undefined) onCreateHighlight?.(prompt.pid, tokenRange.start, tokenRange.end, colorIndex);
      else onPickSpan?.(prompt.pid, tokenRange.start, tokenRange.end, selectedText);
    },
    [prompt, onCreateHighlight, onPickSpan]
  );

  return (
    <div ref={wrapperRef} className="relative">
      <div ref={containerRef} className={className} dangerouslySetInnerHTML={markup} />

      {canSelect && prompt && (
        // BELOW the selection, never above — the mobile OS draws its own
        // "Copiar / Selecionar tudo" bar over the top of one (see the same
        // note in bible-chapter-view.tsx).
        <div
          style={{ left: prompt.left, top: prompt.top, transform: "translateX(-50%)" }}
          className="absolute z-50 flex items-center gap-1 whitespace-nowrap rounded-full bg-card px-2 py-1.5 shadow-[0_8px_20px_var(--shadow)]"
        >
          {onCreateHighlight &&
            Object.keys(JWLIBRARY_HIGHLIGHT_COLORS).map((index) => (
              <HighlightSwatch key={index} colorIndex={Number(index)} onClick={() => confirm(Number(index))} />
            ))}
          {onCreateHighlight && onPickSpan && <span className="mx-0.5 h-5 w-px bg-border" />}
          {onPickSpan && (
            <button
              type="button"
              onClick={() => confirm()}
              aria-label="Anotar sem destaque"
              title="Anotar sem destaque"
              className="flex size-6 items-center justify-center rounded-full text-accent transition-colors hover:bg-accent/10"
            >
              <NotebookPen className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
