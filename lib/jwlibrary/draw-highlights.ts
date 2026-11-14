import type { ParagraphHighlight } from "@/app/(app)/jwlibrary-actions";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import { unwrapHighlightMarks, wrapTokenRange } from "@/lib/jwlibrary/paragraph-tokens";

/**
 * Paints a document's highlights into already-rendered HTML — a `<mark>` over
 * each highlighted span, plus a small square in the left margin for every
 * highlight that carries a note, coloured like the highlight it belongs to and
 * positioned at the line the highlight *starts* on (one paragraph can hold
 * several differently coloured ones). A note with no highlight (a "nota sem
 * destaque") has nothing to wrap, so it only gets a neutral square.
 *
 * Both the marks and the squares carry `data-jwlibrary-usermark-id` /
 * `data-jwlibrary-note-id`, which is what the readers' click handlers look for.
 *
 * Always unwraps first: the DOM built by `dangerouslySetInnerHTML` isn't reset
 * when `highlights` changes, so redrawing without it would nest marks.
 */
export function drawParagraphHighlights(container: HTMLElement, highlights: ParagraphHighlight[]) {
  unwrapHighlightMarks(container);

  for (const highlight of highlights) {
    const el = container.querySelector<HTMLElement>(`[data-pid="${highlight.pid}"]`);
    if (!el) continue;

    if (highlight.colorIndex === null || highlight.startToken === null || highlight.endToken === null) {
      if (!highlight.note) continue;
      addNoteMarker(el, highlight.note.id, "var(--muted-foreground)", 0);
      continue;
    }

    const colorHex = JWLIBRARY_HIGHLIGHT_COLORS[highlight.colorIndex]?.hex ?? JWLIBRARY_HIGHLIGHT_COLORS[1].hex;
    const mark = wrapTokenRange(el, highlight.startToken, highlight.endToken, colorHex, highlight.id, highlight.note?.id);
    // Stamped so a note-less highlight's click handler can show the
    // highlighted text itself (there's no note to display instead).
    if (mark) mark.dataset.jwlibraryText = mark.textContent ?? "";

    if (highlight.note && mark) addNoteMarker(el, highlight.note.id, colorHex, mark.offsetTop);
  }
}

function addNoteMarker(paragraph: HTMLElement, noteId: string, color: string, top: number) {
  paragraph.style.position = "relative";
  const marker = document.createElement("span");
  marker.className = "jwlibrary-note-marker";
  marker.dataset.jwlibraryNoteId = noteId;
  Object.assign(marker.style, {
    position: "absolute",
    left: "-14px",
    top: `${top}px`,
    width: "8px",
    height: "8px",
    borderRadius: "2px",
    backgroundColor: color,
    cursor: "pointer",
  });
  paragraph.insertBefore(marker, paragraph.firstChild);
}

export type HighlightClick =
  | { kind: "note"; highlight: ParagraphHighlight }
  | { kind: "mark"; highlight: ParagraphHighlight; text?: string };

/** What a click landed on, if it was a drawn note square or highlight (see drawParagraphHighlights). */
export function highlightFromClick(target: HTMLElement | null, highlights: ParagraphHighlight[]): HighlightClick | null {
  const noteMark = target?.closest<HTMLElement>("[data-jwlibrary-note-id]");
  if (noteMark) {
    const noteId = noteMark.dataset.jwlibraryNoteId;
    const highlight = highlights.find((h) => h.note?.id === noteId);
    return highlight?.note ? { kind: "note", highlight } : null;
  }

  const usermarkEl = target?.closest<HTMLElement>("[data-jwlibrary-usermark-id]");
  if (usermarkEl) {
    const id = usermarkEl.dataset.jwlibraryUsermarkId;
    const highlight = highlights.find((h) => h.id === id);
    return highlight ? { kind: "mark", highlight, text: usermarkEl.dataset.jwlibraryText } : null;
  }
  return null;
}
