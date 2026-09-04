"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { NotebookPen } from "lucide-react";
import type { BibleVerseRow } from "@/app/(app)/bible-actions";
import type { BibleVerseHighlight } from "@/app/(app)/jwlibrary-actions";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import { wrapTokenRange, getTokenRangeForSelection } from "@/lib/jwlibrary/paragraph-tokens";

interface BibleChapterViewProps {
  verses: BibleVerseRow[];
  /** Selecting a span by dragging offers to anchor a new note/highlight to it. `colorIndex` is set when a color swatch was tapped directly; `selectedText` is for the editor's preview only. */
  onPickVerseSpan?: (verse: number, startToken: number, endToken: number, colorIndex?: number, selectedText?: string) => void;
  /** Fired whenever a verse is tapped or drag-selected — lets bible-reader.tsx refresh the references panel for whatever verse the reader is currently looking at, when that panel is open. A plain tap fires this without creating any actual text selection (see the click handler below) — it used to auto-select the whole verse, but that made every tap put the verse into an editable-looking selected state, which got in the way of just glancing at references. */
  onVerseSelected?: (verse: number) => void;
  /** Imported/created highlights for this chapter — see getBibleChapterHighlights in jwlibrary-actions.ts. */
  highlights?: BibleVerseHighlight[];
  /** A highlight with an attached note was clicked. */
  onHighlightNote?: (note: { id: string; title: string; content: string }) => void;
  /** Scrolls to and briefly flashes this verse on mount — deep link from a jwlibrary Bible note, or from picking a cross reference (see bible-reader.tsx's `?verse=`/navigateTo). */
  targetVerse?: number | null;
  /** How many footnotes each verse has, keyed by verse number. */
  footnoteCountByVerse?: Map<number, number>;
  /** Verse numbers that have a study note. */
  studyNoteVerses?: Set<number>;
  /** A footnote/study-note marker was clicked — opens the study panel on that tab. */
  onOpenStudy?: (verse: number, tab: "notas" | "rodape") => void;
}

/**
 * Bible-reading counterpart to jwpub-chapter-view.tsx — same highlight/note
 * mechanics (word-token ranges via lib/jwlibrary/paragraph-tokens.ts, the
 * 6-color selection popup, margin note markers), but verses render as plain
 * JSX (bible_verses.text is always plain text, never HTML, unlike a .jwpub
 * chapter) instead of dangerouslySetInnerHTML, and there's no footnote/
 * "Your answer" machinery to progressively enhance.
 */
export function BibleChapterView({
  verses,
  onPickVerseSpan,
  onVerseSelected,
  highlights = [],
  onHighlightNote,
  targetVerse,
  footnoteCountByVerse,
  studyNoteVerses,
  onOpenStudy,
}: BibleChapterViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Highlight-note click listener, plus: tapping a verse (no drag) just
  // reports which verse was tapped (for the references panel) — it does
  // NOT select any text itself. Highlighting a verse is still done by
  // dragging across its text, same as a jwpub paragraph.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(event: MouseEvent) {
      const el = event.target as HTMLElement | null;

      const highlightMark = el?.closest<HTMLElement>("[data-jwlibrary-note-id]");
      if (highlightMark) {
        const noteId = highlightMark.dataset.jwlibraryNoteId;
        const note = highlights.find((h) => h.note?.id === noteId)?.note;
        if (note) onHighlightNote?.(note);
        return;
      }

      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;

      const verseEl = el?.closest<HTMLElement>("[data-verse]");
      if (!verseEl) return;

      const verse = Number(verseEl.dataset.verse);
      if (Number.isFinite(verse)) onVerseSelected?.(verse);
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [highlights, onHighlightNote, onVerseSelected]);

  // Same delayed selection-popup mechanics as jwpub-chapter-view.tsx —
  // deliberately duplicated rather than shared: that logic was only just
  // calibrated there this session (the delay, the color popup), and
  // extracting a shared hook now would risk regressing the already-working
  // publication reader for a DRY win that isn't worth it for two call sites.
  const SELECTION_PROMPT_DELAY_MS = 350;
  const [selectionPrompt, setSelectionPrompt] = useState<{ x: number; y: number; verse: number; range: Range } | null>(
    null
  );

  useEffect(() => {
    let delayTimer: ReturnType<typeof setTimeout> | null = null;

    function handleSelectionChange() {
      if (delayTimer) clearTimeout(delayTimer);

      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectionPrompt(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const anchorEl = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element);
      const verseEl = anchorEl?.closest<HTMLElement>("[data-verse]");
      if (!verseEl || !container.contains(verseEl) || !verseEl.dataset.verse) {
        setSelectionPrompt(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelectionPrompt(null);
        return;
      }

      const verse = Number(verseEl.dataset.verse);
      const clonedRange = range.cloneRange();
      delayTimer = setTimeout(() => {
        setSelectionPrompt({ x: rect.left + rect.width / 2, y: rect.top, verse, range: clonedRange });
        onVerseSelected?.(verse);
      }, SELECTION_PROMPT_DELAY_MS);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (delayTimer) clearTimeout(delayTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onVerseSelected intentionally not re-subscribed on every render; it's a stable callback from useCallback in bible-reader.tsx
  }, []);

  function confirmSelectionSpan(colorIndex?: number) {
    if (!selectionPrompt) return;
    const verseEl = containerRef.current?.querySelector<HTMLElement>(`[data-verse="${selectionPrompt.verse}"]`);
    if (!verseEl) return;

    const tokenRange = getTokenRangeForSelection(verseEl, selectionPrompt.range);
    const selectedText = selectionPrompt.range.toString();
    window.getSelection()?.removeAllRanges();
    setSelectionPrompt(null);
    if (tokenRange) {
      onPickVerseSpan?.(selectionPrompt.verse, tokenRange.start, tokenRange.end, colorIndex, selectedText);
    }
  }

  // Draws highlights — identical mechanics to jwpub-chapter-view.tsx's own
  // effect, keyed by verse number instead of a paragraph's data-pid.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || highlights.length === 0) return;

    for (const highlight of highlights) {
      const el = container.querySelector<HTMLElement>(`[data-verse="${highlight.verse}"]`);
      if (!el) continue;
      const colorHex = JWLIBRARY_HIGHLIGHT_COLORS[highlight.colorIndex]?.hex ?? JWLIBRARY_HIGHLIGHT_COLORS[1].hex;
      const mark = wrapTokenRange(el, highlight.startToken, highlight.endToken, colorHex, highlight.note?.id);

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

  // Deep-link scroll — same pattern as jwpub-chapter-view.tsx's `?pid=` effect.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !targetVerse) return;

    const el = container.querySelector(`[data-verse="${targetVerse}"]`);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-accent", "bg-accent/20", "rounded-xl", "p-2.5", "transition-all", "duration-500");

    const timer = setTimeout(() => {
      el.classList.remove("ring-2", "ring-accent", "bg-accent/20");
    }, 4500);

    return () => clearTimeout(timer);
  }, [verses, targetVerse]);

  return (
    <>
      <motion.div
        key={verses[0]?.id ?? "empty"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        ref={containerRef}
        className="mx-auto w-full max-w-2xl text-[15px] leading-relaxed text-foreground/90"
      >
        {/*
          `whitespace-pre-line` (here and in the other two surfaces that render
          verse text) is what makes poetry actually break: bible_verses.text
          carries real `\n` for 7.560 verses — see data/NWT_structure.md — and
          without this the browser's default `white-space: normal` collapses
          each one into a space, running Psalms together as prose. `pre-line`
          rather than `pre-wrap`/`pre`: newlines are preserved, but every
          other run of whitespace still collapses and lines still wrap.

          It's on the inner <span> for a verse, not the <p>, purely to keep it
          off the `parNum` span's layout. Word-token indexing
          (lib/jwlibrary/paragraph-tokens.ts) is unaffected either way — it
          walks text nodes, so a CSS property can't move a token index.
        */}
        {verses.map((v) =>
          v.isSuperscription ? (
            <p key={v.id} className="my-4 whitespace-pre-line italic text-muted-foreground">
              {v.text}
            </p>
          ) : (
            <p key={v.id} data-verse={v.verse ?? undefined} className="relative my-3 text-pretty">
              <span className="parNum mr-1.5 select-none align-super font-mono text-[11px] text-muted-foreground">
                {v.verse}
              </span>
              <span className="whitespace-pre-line">{v.text ?? "texto não disponível nesta tradução"}</span>
              {/*
                Markers go at the END of the verse, not inline at the word that
                produced them: the source has no word-level position for either
                footnotes or study notes (that would need BibleChapter.Content's
                own markers, which aren't in data/nwt_st.sqlite). `.verse-affordance`
                keeps these out of word-token indexing — see
                lib/jwlibrary/paragraph-tokens.ts.
              */}
              {v.verse !== null && (footnoteCountByVerse?.get(v.verse) || studyNoteVerses?.has(v.verse)) ? (
                <span className="verse-affordance ml-1 inline-flex select-none items-center gap-1 align-super">
                  {footnoteCountByVerse?.get(v.verse) ? (
                    <button
                      type="button"
                      onClick={() => onOpenStudy?.(v.verse!, "rodape")}
                      aria-label={`Notas de rodapé do versículo ${v.verse}`}
                      className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-accent"
                    >
                      *
                    </button>
                  ) : null}
                  {studyNoteVerses?.has(v.verse) ? (
                    <button
                      type="button"
                      onClick={() => onOpenStudy?.(v.verse!, "notas")}
                      aria-label={`Nota de estudo do versículo ${v.verse}`}
                      className="size-1.5 rounded-full bg-accent/60 transition-colors hover:bg-accent"
                    />
                  ) : null}
                </span>
              ) : null}
            </p>
          )
        )}
      </motion.div>

      {selectionPrompt && (
        // Sibling of the motion.div above, not nested inside it — same
        // reasoning as jwpub-chapter-view.tsx's identical popup.
        <div
          style={{
            position: "fixed",
            left: selectionPrompt.x,
            top: Math.max(8, selectionPrompt.y - 44),
            transform: "translateX(-50%)",
          }}
          className="z-50 flex items-center gap-1 whitespace-nowrap rounded-full bg-card px-2 py-1.5 shadow-[0_8px_20px_rgba(0,0,0,0.4)]"
        >
          {Object.entries(JWLIBRARY_HIGHLIGHT_COLORS).map(([index, color]) => (
            <button
              key={index}
              type="button"
              onClick={() => confirmSelectionSpan(Number(index))}
              aria-label={color.name}
              title={color.name}
              className="size-6 rounded-full border-2 border-transparent transition-transform hover:scale-110 active:scale-95"
              style={{ backgroundColor: color.hex }}
            />
          ))}
          <span className="mx-0.5 h-5 w-px bg-border" />
          <button
            type="button"
            onClick={() => confirmSelectionSpan()}
            aria-label="Anotar sem destaque"
            title="Anotar sem destaque"
            className="flex size-6 items-center justify-center rounded-full text-accent transition-colors hover:bg-accent/10"
          >
            <NotebookPen className="size-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
