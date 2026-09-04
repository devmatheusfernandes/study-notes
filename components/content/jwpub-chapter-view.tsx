"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { NotebookPen } from "lucide-react";
import { sanitizeChapterHtml } from "@/lib/jwpub/sanitize";
import { saveAnswer } from "@/app/(app)/jwpub-actions";
import type { ParagraphHighlight } from "@/app/(app)/jwlibrary-actions";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import { wrapTokenRange, getTokenRangeForSelection } from "@/lib/jwlibrary/paragraph-tokens";

interface JwpubChapterViewProps {
  html: string;
  publicationId: string;
  documentId: number;
  /** Saved "Your answer" text, keyed `"<documentId>:<pid>"` — see getAnswers in jwpub-actions.ts. */
  answers: Record<string, string>;
  onFootnote: (footnoteId: number) => void;
  onBibleRef: (firstVerseId: number, lastVerseId: number) => void;
  /** "Anotar" mode (Fase 2) — while true, clicking any paragraph/heading (without selecting text) picks the whole thing for a new jwlibrary note instead of the normal footnote/bible-ref handling. Selecting a specific span works independently of this mode — see onPickParagraphSpan. */
  pickingParagraph?: boolean;
  onPickParagraph?: (pid: string) => void;
  /** Selecting any text in the chapter (no mode needed) offers to anchor a new note to that exact span (Fase 2.5). `colorIndex` is set when the user tapped a color swatch directly instead of the plain note icon; `selectedText` is the raw selected text, for the editor's preview only. */
  onPickParagraphSpan?: (
    pid: string,
    startToken: number,
    endToken: number,
    colorIndex?: number,
    selectedText?: string
  ) => void;
  /** Imported JW Library highlights for this chapter (Fase 2.5) — see getChapterHighlights in jwlibrary-actions.ts. */
  highlights?: ParagraphHighlight[];
  /** A highlight with an attached note was clicked. */
  onHighlightNote?: (note: { id: string; title: string; content: string }) => void;
}

const ANSWER_BASE_CLASS =
  "field-sizing-content min-h-16 w-full min-w-0 rounded-2xl border bg-secondary px-4 py-3 text-[13.5px] text-foreground placeholder:text-muted-foreground outline-none transition-colors duration-300";
const ANSWER_IDLE_CLASS = "border-border";
const ANSWER_TYPING_CLASS = "border-accent ring-1 ring-accent/40";
const ANSWER_SAVED_CLASS = "border-success ring-1 ring-success/40";

export function JwpubChapterView({
  html,
  publicationId,
  documentId,
  answers,
  onFootnote,
  onBibleRef,
  pickingParagraph = false,
  onPickParagraph,
  onPickParagraphSpan,
  highlights = [],
  onHighlightNote,
}: JwpubChapterViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const highlightText = searchParams.get("text");

  // Footnote + bible reference + highlight-note click listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(event: MouseEvent) {
      const el = event.target as HTMLElement | null;

      if (pickingParagraph) {
        const target = el?.closest<HTMLElement>("[data-pid]");
        if (target?.dataset.pid) {
          event.preventDefault();
          onPickParagraph?.(target.dataset.pid);
        }
        return;
      }

      const footnote = el?.closest<HTMLElement>("[data-jwpub-footnote]");
      if (footnote) {
        event.preventDefault();
        const id = Number(footnote.dataset.jwpubFootnote);
        if (Number.isFinite(id)) onFootnote(id);
        return;
      }

      const bible = el?.closest<HTMLElement>("[data-jwpub-bible-first]");
      if (bible) {
        event.preventDefault();
        const first = Number(bible.dataset.jwpubBibleFirst);
        const last = Number(bible.dataset.jwpubBibleLast);
        if (Number.isFinite(first) && Number.isFinite(last)) onBibleRef(first, last);
        return;
      }

      const highlightMark = el?.closest<HTMLElement>("[data-jwlibrary-note-id]");
      if (highlightMark) {
        const noteId = highlightMark.dataset.jwlibraryNoteId;
        const note = highlights.find((h) => h.note?.id === noteId)?.note;
        if (note) onHighlightNote?.(note);
      }
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [onFootnote, onBibleRef, pickingParagraph, onPickParagraph, highlights, onHighlightNote]);

  // Selecting text always offers to anchor a new note to that exact span —
  // no need to switch into "Anotar" mode first (that mode is only for
  // clicking a *whole* paragraph without selecting anything, see the click
  // handler above). Deliberately NOT wired to `mouseup` — that never fires
  // reliably for a touch-made selection (long-press + drag handles are
  // native OS UI on mobile), so this listens to `selectionchange` instead
  // (fires on every platform). The popup itself is delayed (SELECTION_PROMPT_DELAY_MS)
  // rather than shown on the very first `selectionchange` — that event fires
  // continuously while the user is still dragging the selection handles, so
  // showing it immediately made the popup flash/jump mid-drag; waiting for
  // the selection to hold still for a moment shows it only once the user has
  // actually settled on a span.
  const SELECTION_PROMPT_DELAY_MS = 350;
  const [selectionPrompt, setSelectionPrompt] = useState<{ x: number; y: number; pid: string; range: Range } | null>(
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
      const paragraphEl = anchorEl?.closest<HTMLElement>("[data-pid]");
      if (!paragraphEl || !container.contains(paragraphEl) || !paragraphEl.dataset.pid) {
        setSelectionPrompt(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelectionPrompt(null);
        return;
      }

      const pid = paragraphEl.dataset.pid;
      const clonedRange = range.cloneRange();
      delayTimer = setTimeout(() => {
        setSelectionPrompt({ x: rect.left + rect.width / 2, y: rect.top, pid, range: clonedRange });
      }, SELECTION_PROMPT_DELAY_MS);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (delayTimer) clearTimeout(delayTimer);
    };
  }, []);

  function confirmSelectionSpan(colorIndex?: number) {
    if (!selectionPrompt) return;
    const paragraphEl = containerRef.current?.querySelector<HTMLElement>(`[data-pid="${selectionPrompt.pid}"]`);
    if (!paragraphEl) return;

    const tokenRange = getTokenRangeForSelection(paragraphEl, selectionPrompt.range);
    const selectedText = selectionPrompt.range.toString();
    window.getSelection()?.removeAllRanges();
    setSelectionPrompt(null);
    if (tokenRange) {
      onPickParagraphSpan?.(selectionPrompt.pid, tokenRange.start, tokenRange.end, colorIndex, selectedText);
    }
  }

  // Progressively enhances the archive's own "Your answer" fields
  // (`<div class="gen-field" data-pid="…"><textarea>`) — restyles them to
  // match the app's Textarea primitive, fills in any previously saved value,
  // and wires up debounced autosave with the orange(typing)/green(saved)
  // border. A field's own id/name repeat across documents (verified against
  // a real archive), so `data-pid` scoped to the current documentId is the
  // only stable save key — see getAnswers/saveAnswer in jwpub-actions.ts.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fields = container.querySelectorAll<HTMLElement>(".gen-field[data-pid]");
    const cleanups: Array<() => void> = [];

    fields.forEach((field) => {
      const pid = field.dataset.pid;
      const textarea = field.querySelector("textarea");
      if (!pid || !textarea) return;

      const label = field.querySelector("label");
      if (label) {
        label.className = "mb-1.5 block text-[11.5px] font-medium text-muted-foreground";
      }
      field.classList.add("my-4");

      const savedValue = answers[`${documentId}:${pid}`] ?? "";
      textarea.value = savedValue;
      textarea.rows = 2;
      textarea.placeholder = "Escreva sua resposta…";
      textarea.className = `${ANSWER_BASE_CLASS} ${savedValue ? ANSWER_SAVED_CLASS : ANSWER_IDLE_CLASS}`;

      let saveTimer: ReturnType<typeof setTimeout> | null = null;

      async function persist() {
        const result = await saveAnswer(publicationId, documentId, pid!, textarea!.value);
        textarea!.className = `${ANSWER_BASE_CLASS} ${result.error ? ANSWER_TYPING_CLASS : ANSWER_SAVED_CLASS}`;
      }

      function handleInput() {
        textarea!.className = `${ANSWER_BASE_CLASS} ${ANSWER_TYPING_CLASS}`;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void persist(), 800);
      }

      function handleBlur() {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
          void persist();
        }
      }

      textarea.addEventListener("input", handleInput);
      textarea.addEventListener("blur", handleBlur);
      cleanups.push(() => {
        textarea.removeEventListener("input", handleInput);
        textarea.removeEventListener("blur", handleBlur);
        if (saveTimer) clearTimeout(saveTimer);
      });
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [html, publicationId, documentId, answers]);

  // Draws imported JW Library highlights (Fase 2.5) — see
  // lib/jwlibrary/paragraph-tokens.ts for the word-token → DOM Range mapping
  // — plus a margin marker for every highlight that has a note attached,
  // matching the real app's own indicator: positioned at the exact line the
  // highlight *starts* on (read off the just-created <mark>'s own position,
  // not just the top of the paragraph) and colored to match that specific
  // highlight, since one paragraph can carry several differently-colored
  // ones. Reuses `data-jwlibrary-note-id`, which the click handler above
  // already listens for, so the marker is clickable for free.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || highlights.length === 0) return;

    for (const highlight of highlights) {
      const el = container.querySelector<HTMLElement>(`[data-pid="${highlight.pid}"]`);
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
  }, [html, highlights]);

  // Auto-scroll & Highlight matching snippet from chat RAG source
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !highlightText) return;

    const lowerTarget = highlightText.toLowerCase();
    const elements = container.querySelectorAll("p, blockquote, li, h1, h2, h3");

    for (const el of Array.from(elements)) {
      if (el.textContent?.toLowerCase().includes(lowerTarget)) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-accent", "bg-accent/20", "rounded-xl", "p-2.5", "transition-all", "duration-500");

        const timer = setTimeout(() => {
          el.classList.remove("ring-2", "ring-accent", "bg-accent/20");
        }, 4500);

        return () => clearTimeout(timer);
      }
    }
  }, [html, highlightText]);

  // Same idea as the `?text=` highlight above, but exact instead of fuzzy —
  // `data-pid` is the archive's own paragraph id, already preserved through
  // sanitization (see sanitize.ts's ALLOWED_ATTR), and is how an imported
  // .jwlibrary note's BlockIdentifier addresses a paragraph.
  const targetPid = searchParams.get("pid");
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !targetPid) return;

    const el = container.querySelector(`[data-pid="${targetPid}"]`);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-accent", "bg-accent/20", "rounded-xl", "p-2.5", "transition-all", "duration-500");

    const timer = setTimeout(() => {
      el.classList.remove("ring-2", "ring-accent", "bg-accent/20");
    }, 4500);

    return () => clearTimeout(timer);
  }, [html, targetPid]);

  return (
    <>
      <motion.div
        key={html.slice(0, 64)}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        ref={containerRef}
        className={[
          "mx-auto w-full max-w-2xl text-[15px] leading-relaxed text-foreground/90",
          "[&_h1]:font-heading [&_h1]:text-2xl [&_h1]:leading-tight [&_h1]:mt-6 [&_h1]:mb-3",
          "[&_h2]:font-heading [&_h2]:text-xl [&_h2]:leading-tight [&_h2]:mt-6 [&_h2]:mb-2.5",
          "[&_h3]:font-heading [&_h3]:text-lg [&_h3]:mt-5 [&_h3]:mb-2",
          "[&_p]:my-3 [&_p]:text-pretty",
          "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-accent/40 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
          "[&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-2xl",
          "[&_table]:my-4 [&_table]:w-full [&_table]:text-[13.5px] [&_td]:border [&_td]:border-border [&_td]:p-2",
          // Footnote markers and resolved bible refs read as tappable; unresolved inline references stay inert.
          "[&_[data-jwpub-footnote]]:cursor-pointer [&_[data-jwpub-footnote]]:text-accent [&_[data-jwpub-footnote]]:underline [&_[data-jwpub-footnote]]:underline-offset-2",
          "[&_[data-jwpub-bible-first]]:cursor-pointer [&_[data-jwpub-bible-first]]:text-accent [&_[data-jwpub-bible-first]]:underline [&_[data-jwpub-bible-first]]:underline-offset-2",
          "[&_[data-jwpub-ref]]:text-foreground/80",
          // "Anotar" mode: every paragraph/heading becomes a click target for a
          // new note, highlighted on hover so it's clear what will be picked.
          pickingParagraph &&
            "[&_[data-pid]:hover]:cursor-pointer [&_[data-pid]:hover]:bg-accent/10 [&_[data-pid]:hover]:rounded-lg [&_[data-pid]]:transition-colors",
        ]
          .filter(Boolean)
          .join(" ")}
        dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(html) }}
      />

      {selectionPrompt && (
        // Rendered as a sibling of the motion.div above, not nested inside it —
        // that element animates a `y` transform, which would turn it into a
        // containing block for `position: fixed` descendants and break this
        // popup's viewport-relative positioning.
        //
        // Shows the 6 highlight colors directly (instead of a plain "Anotar
        // trecho" button that opened the editor empty) so tapping a color
        // opens the note editor with that color already selected — one fewer
        // step than picking it again inside the editor. The plain note icon
        // stays for anchoring a note to the span with no highlight.
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
