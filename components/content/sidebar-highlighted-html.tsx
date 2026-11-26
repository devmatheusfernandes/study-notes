"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { HighlightSwatch } from "@/components/ui/highlight-swatch";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import type { HighlightClick } from "@/lib/jwlibrary/draw-highlights";
import type { JwlibraryLocation } from "@/lib/jwlibrary/types";
import { useDocumentHighlights } from "@/hooks/use-document-highlights";
import { notify } from "@/components/ui/toaster";
import { useBibleDownloaded } from "@/hooks/use-bible-downloaded";
import { readOfflineBiblePassage } from "@/lib/offline/bible-offline";
import { parseInertBibleRef, passageLabel } from "@/lib/bible/inert-reference";
import {
  queueCreateHighlight,
  queueDeleteHighlight,
  queueDeleteNote,
  queueSetHighlightColor,
} from "@/lib/offline/jwlibrary-mutations";
import { resolveDocumentLocation, type ParagraphHighlight } from "@/app/(app)/jwlibrary-actions";
import type { BibleVerseRow } from "@/app/(app)/bible-actions";
import { HighlightableHtml } from "./highlightable-html";
import { InlineHighlightNote, type NewNoteInput } from "./inline-highlight-note";

interface SidebarHighlightedHtmlProps {
  /** Trusted markup, rendered as-is. */
  html: string;
  /** The document being shown, or null when it isn't one a highlight can be filed under. */
  mepsDocumentId: number | null;
  /** The publication's symbol if the caller knows it — only used when nothing better is on record. */
  symbolHint?: string | null;
  /** For an excerpt: its article's title, so marks filed under a twin document of the same article are found too. */
  titleHint?: string | null;
  className?: string;
  /**
   * When given, the host's panel header owns the "back to the text" button: this is called with the
   * handler while a note, a highlight or a Bible passage is open and with null when it closes, and
   * the in-body Voltar button is dropped. `title` is set only for a passage (its reference,
   * "1 João 4:16") — the host may show it in place of its own.
   */
  onNoteChange?: (back: (() => void) | null, title?: string) => void;
}

/** What has taken the text's place in the panel. */
type View =
  | { kind: "passage"; label: string; verses: BibleVerseRow[] }
  /** An existing note, being read or edited. */
  | { kind: "note"; noteId: string; editing: boolean }
  /** A highlight with no note: recolour, annotate or delete it. */
  | { kind: "mark"; markId: string; text?: string }
  /** A note being written, on a fresh selection (`span`) or on an existing highlight (`markId`). */
  | {
      kind: "draft";
      pid: string;
      location: JwlibraryLocation;
      span?: { start: number; end: number };
      markId?: string;
      text?: string;
    };

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

const LOCATION_TIMEOUT_MS = 2500;

/** The location new marks on this document are filed under, looked up once and only when needed. */
function useDocumentLocation(mepsDocumentId: number | null, symbolHint: string | null) {
  const cache = useRef<{ key: string; promise: Promise<JwlibraryLocation> } | null>(null);

  return useCallback((): Promise<JwlibraryLocation> | null => {
    if (mepsDocumentId === null) return null;
    const key = `${mepsDocumentId}:${symbolHint ?? ""}`;
    if (cache.current?.key !== key) {
      const fallback = { keySymbol: symbolHint, mepsLanguage: 5, issueTagNumber: 0 };
      // Offline (or slow): file it under the best guess instead of making the user wait.
      const resolved = Promise.race([
        resolveDocumentLocation(mepsDocumentId, symbolHint).catch(() => fallback),
        new Promise<typeof fallback>((r) => setTimeout(() => r(fallback), LOCATION_TIMEOUT_MS)),
      ]);
      cache.current = {
        key,
        promise: resolved.then((found) => ({
          ...found,
          bookNumber: null,
          chapterNumber: null,
          mepsDocumentId,
          track: null,
          locationType: 0,
        })),
      };
    }
    return cache.current.promise;
  }, [mepsDocumentId, symbolHint]);
}

function Quote({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <blockquote className="line-clamp-4 rounded-xl border-l-2 border-accent/50 bg-secondary/50 px-3 py-2 text-[13px] italic leading-relaxed text-muted-foreground">
      “{text}”
    </blockquote>
  );
}

function ColorRow({ selected, onPick }: { selected: number | null; onPick: (colorIndex: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {Object.keys(JWLIBRARY_HIGHLIGHT_COLORS).map((index) => (
        <HighlightSwatch
          key={index}
          size="md"
          colorIndex={Number(index)}
          selected={selected === Number(index)}
          onClick={() => onPick(Number(index))}
        />
      ))}
    </div>
  );
}

/**
 * A document opened in a side panel (a cited publication, an appendix) with the
 * user's highlights drawn on it, and the same marking as the full readers:
 * select text for a colour or a note, tap a mark or a note's square to open it.
 * Everything happens *in place* — the panel's content swaps for the note or the
 * highlight, with a "Voltar ao trecho" button that returns to exactly where the
 * reading was — so a side panel never opens a second one. The text stays mounted
 * underneath (just hidden), so going back doesn't re-render the article.
 */
export function SidebarHighlightedHtml({
  html,
  mepsDocumentId,
  symbolHint = null,
  titleHint,
  className,
  onNoteChange,
}: SidebarHighlightedHtmlProps) {
  const { highlights, setHighlights } = useDocumentHighlights(mepsDocumentId, titleHint);
  const getLocation = useDocumentLocation(mepsDocumentId, symbolHint);
  const wrapRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const [view, setView] = useState<View | null>(null);
  // The colour chosen for the draft being written (null: a note with no highlight).
  const [draftColor, setDraftColor] = useState<number | null>(null);
  /** The highlight/note the draft has created so far — a state for rendering, a ref for saving. */
  const [draftCreated, setDraftCreated] = useState<{ markId: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A scripture citation in the text, opened in place of it — only offered once the Bible is on the device.
  const bibleDownloaded = useBibleDownloaded();

  const open = useCallback((next: View) => {
    setView((current) => {
      if (!current) {
        const scroller = scrollParent(wrapRef.current);
        savedScroll.current = scroller ? scroller.scrollTop : window.scrollY;
      }
      return next;
    });
  }, []);

  const back = useCallback(() => {
    setView(null);
    // Once the hidden text is visible again, put the reader back where they were.
    requestAnimationFrame(() => {
      const scroller = scrollParent(wrapRef.current);
      if (scroller) scroller.scrollTop = savedScroll.current;
      else window.scrollTo(0, savedScroll.current);
    });
  }, []);

  const handleClick = useCallback(
    (click: HighlightClick) => {
      if (click.kind === "note" && click.highlight.note) {
        open({ kind: "note", noteId: click.highlight.note.id, editing: false });
      } else if (click.kind === "mark") {
        open({ kind: "mark", markId: click.highlight.id, text: click.text });
      }
    },
    [open]
  );

  const createHighlight = useCallback(
    async (pid: string, startToken: number, endToken: number, colorIndex: number) => {
      const location = await getLocation();
      if (!location) return;
      const id = queueCreateHighlight({
        blockType: 1,
        blockIdentifier: Number(pid),
        location,
        colorIndex,
        startToken,
        endToken,
      });
      setHighlights((prev) => [...prev, { id, pid, colorIndex, startToken, endToken, note: null }]);
    },
    [getLocation, setHighlights]
  );

  const startDraft = useCallback(
    async (draft: { pid: string; span?: { start: number; end: number }; markId?: string; text?: string; color: number | null }) => {
      const location = await getLocation();
      if (!location) return;
      setDraftColor(draft.color);
      setDraftCreated(null);
      open({ kind: "draft", pid: draft.pid, location, span: draft.span, markId: draft.markId, text: draft.text });
    },
    [getLocation, open]
  );

  const pickSpan = useCallback(
    (pid: string, startToken: number, endToken: number, selectedText: string) => {
      void startDraft({ pid, span: { start: startToken, end: endToken }, text: selectedText, color: null });
    },
    [startDraft]
  );

  function recolor(markId: string, colorIndex: number) {
    setHighlights((prev) => prev.map((h) => (h.id === markId ? { ...h, colorIndex } : h)));
    queueSetHighlightColor(markId, colorIndex);
  }

  const openPassage = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      if (!bibleDownloaded) return;
      const target = event.target as HTMLElement | null;
      // A mark over a citation is a click on the mark.
      if (target?.closest("mark.jwlibrary-highlight")) return;
      const link = target?.closest<HTMLAnchorElement>("a[data-jwpub-ref]");
      const ref = parseInertBibleRef(link?.dataset.jwpubRef);
      if (!link || !ref) return;
      // Dragging across the text to highlight it ends in a click — not a request to open the verse.
      if (window.getSelection()?.toString()) return;
      event.preventDefault();

      const verses = await readOfflineBiblePassage(ref);
      if (!verses) {
        notify.error("Não encontrei esse texto na Bíblia baixada");
        return;
      }
      open({ kind: "passage", label: passageLabel(verses), verses });
    },
    [bibleDownloaded, open]
  );

  // The host's header follows what is open. Through a ref: a host passes a new function every render.
  const onNoteChangeRef = useRef(onNoteChange);
  useEffect(() => {
    onNoteChangeRef.current = onNoteChange;
  });
  const isOpen = view !== null;
  const passageTitle = view?.kind === "passage" ? view.label : undefined;
  useEffect(() => {
    if (!isOpen) return;
    onNoteChangeRef.current?.(back, passageTitle);
    return () => onNoteChangeRef.current?.(null);
  }, [isOpen, passageTitle, back]);

  const hostOwnsBack = Boolean(onNoteChange);
  const noteHighlight =
    view?.kind === "note" ? highlights.find((h) => h.note?.id === view.noteId) : undefined;
  const mark = view?.kind === "mark" ? highlights.find((h) => h.id === view.markId) : undefined;
  const noteColor = noteHighlight?.colorIndex ?? null;

  /** Puts a saved note on the highlight list, so its square shows when the text comes back. */
  function applyNote(
    note: { id: string; title: string; content: string },
    target: { pid: string; markId: string | null; span?: { start: number; end: number }; colorIndex: number | null }
  ) {
    setHighlights((prev) => {
      if (prev.some((h) => h.note?.id === note.id)) return prev.map((h) => (h.note?.id === note.id ? { ...h, note } : h));
      if (target.markId && prev.some((h) => h.id === target.markId)) {
        return prev.map((h) => (h.id === target.markId ? { ...h, note } : h));
      }
      const added: ParagraphHighlight = {
        id: target.markId ?? `note:${note.id}`,
        pid: target.pid,
        colorIndex: target.markId ? target.colorIndex : null,
        startToken: target.span?.start ?? null,
        endToken: target.span?.end ?? null,
        note,
      };
      return [...prev, added];
    });
  }

  function handleDelete() {
    setConfirmDelete(false);
    if (view?.kind === "note") {
      const { noteId } = view;
      queueDeleteNote(noteId);
      setHighlights((prev) =>
        prev.flatMap((h) => (h.note?.id !== noteId ? [h] : h.colorIndex === null ? [] : [{ ...h, note: null }]))
      );
    } else if (view?.kind === "mark") {
      const { markId } = view;
      queueDeleteHighlight(markId);
      setHighlights((prev) => prev.filter((h) => h.id !== markId));
    }
    back();
  }

  // A draft on a fresh span can choose a colour until it is saved; after that only if it made a highlight.
  const draftMarkId = view?.kind === "draft" ? (view.markId ?? draftCreated?.markId ?? null) : null;
  const draftCanColor = view?.kind === "draft" && (!draftCreated || draftMarkId !== null);

  return (
    // data-page-markers: the printed page numbers show in the margin, wherever the text has them (globals.css).
    <div ref={wrapRef} data-page-markers onPointerDownCapture={() => void getLocation()}>
      {/* `a.b` is how the archive marks a scripture link; it only looks (and acts) like one once the Bible is downloaded. */}
      <div
        onClick={bibleDownloaded ? (event) => void openPassage(event) : undefined}
        className={
          view
            ? "hidden"
            : bibleDownloaded
              ? "[&_a.b[data-jwpub-ref]]:cursor-pointer [&_a.b[data-jwpub-ref]]:text-accent [&_a.b[data-jwpub-ref]]:underline [&_a.b[data-jwpub-ref]]:underline-offset-2"
              : undefined
        }
      >
        <HighlightableHtml
          html={html}
          className={className}
          highlights={highlights}
          onHighlightClick={handleClick}
          onCreateHighlight={
            mepsDocumentId === null ? undefined : (pid, start, end, color) => void createHighlight(pid, start, end, color)
          }
          onPickSpan={mepsDocumentId === null ? undefined : pickSpan}
        />
      </div>

      {view && (
        <div className="flex flex-col gap-3">
          {!hostOwnsBack && (
            <Button variant="ghost" size="sm" leftIcon={<ChevronLeft />} onClick={back} className="-ml-2 self-start">
              Voltar ao trecho
            </Button>
          )}

          {view.kind === "passage" && (
            <>
              {!hostOwnsBack && <span className="font-heading text-[15px]">{view.label}</span>}
              {/* whitespace-pre-line: verse text carries real \n for poetry (see bible-chapter-view.tsx). */}
              <div className="text-[14.5px] leading-relaxed text-foreground/90">
                {view.verses.map((verse, index) => (
                  <div key={verse.id}>
                    {(index === 0 || verse.chapter !== view.verses[index - 1].chapter) &&
                      view.verses[0].chapter !== view.verses[view.verses.length - 1].chapter && (
                        <span className="mt-3 block font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
                          CAPÍTULO {verse.chapter}
                        </span>
                      )}
                    <p data-verse={verse.verse ?? undefined} className="my-2 whitespace-pre-line">
                      <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{verse.verse}</span>
                      {verse.text ?? <span className="italic text-muted-foreground">texto não disponível nesta tradução</span>}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          {view.kind === "note" && noteHighlight?.note && (
            <>
              <div className="flex items-center gap-1">
                <span
                  className="mr-1 size-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor:
                      noteColor === null ? "var(--muted-foreground)" : JWLIBRARY_HIGHLIGHT_COLORS[noteColor]?.hex,
                  }}
                  aria-hidden
                />
                <span className="mr-auto font-mono text-[10px] tracking-[0.08em] text-muted-foreground">NOTA</span>
                {!view.editing && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Editar nota"
                    title="Editar nota"
                    onClick={() => setView({ ...view, editing: true })}
                    className="size-7"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Excluir nota"
                  title="Excluir nota"
                  onClick={() => setConfirmDelete(true)}
                  className="size-7 text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              {view.editing ? (
                <>
                  {noteColor !== null && (
                    <ColorRow selected={noteColor} onPick={(color) => recolor(noteHighlight.id, color)} />
                  )}
                  <InlineHighlightNote
                    key={view.noteId}
                    note={noteHighlight.note}
                    onSaved={(note) =>
                      setHighlights((prev) => prev.map((h) => (h.note?.id === note.id ? { ...h, note } : h)))
                    }
                  />
                </>
              ) : (
                <>
                  {noteHighlight.note.title && (
                    <span className="font-heading text-[15px]">{noteHighlight.note.title}</span>
                  )}
                  {noteHighlight.note.content && (
                    <div
                      className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2"
                      // Plain text (imported) or Tiptap HTML (written here) — sanitized like any other untrusted HTML.
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(noteHighlight.note.content, { USE_PROFILES: { html: true } }),
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}

          {view.kind === "mark" && mark && (
            <>
              <Quote text={view.text} />
              <div className="flex flex-col gap-1.5">
                <span className="text-[11.5px] text-muted-foreground">Cor do destaque</span>
                <ColorRow selected={mark.colorIndex} onPick={(color) => recolor(mark.id, color)} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Plus />}
                onClick={() => void startDraft({ pid: mark.pid, markId: mark.id, text: view.text, color: mark.colorIndex })}
                className="self-start text-accent"
              >
                Adicionar nota
              </Button>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Trash2 />}
                onClick={() => setConfirmDelete(true)}
                className="self-start text-destructive"
              >
                Excluir destaque
              </Button>
            </>
          )}

          {view.kind === "draft" && (
            <>
              <Quote text={view.text} />
              {draftCanColor && (
                <ColorRow
                  selected={draftColor}
                  onPick={(color) => {
                    setDraftColor(color);
                    if (draftMarkId) recolor(draftMarkId, color);
                  }}
                />
              )}
              <InlineHighlightNote
                note={null}
                createInput={(): NewNoteInput => ({
                  blockType: 1,
                  blockIdentifier: Number(view.pid),
                  location: view.location,
                  attachToUserMarkId: view.markId,
                  highlight:
                    !view.markId && view.span && draftColor !== null
                      ? { colorIndex: draftColor, startToken: view.span.start, endToken: view.span.end }
                      : null,
                })}
                onSaved={(note, created) => {
                  const markId = view.markId ?? created?.userMarkId ?? draftCreated?.markId ?? null;
                  if (created) setDraftCreated({ markId });
                  applyNote(note, { pid: view.pid, markId, span: view.span, colorIndex: draftColor });
                }}
              />
              <span className="text-[11.5px] text-muted-foreground">Salva automaticamente.</span>
            </>
          )}
        </div>
      )}

      <ConfirmVault
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={view?.kind === "note" ? "Excluir nota?" : "Excluir destaque?"}
        description="Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
        onConfirm={handleDelete}
      />
    </div>
  );
}
