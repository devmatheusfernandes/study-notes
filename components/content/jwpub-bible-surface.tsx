"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { motion } from "framer-motion";
import {
  getBibleVerseRange,
  listBibleBooks,
  type BibleBook,
  type BibleVerseRow,
} from "@/app/(app)/bible-actions";
import {
  getBibleChapterHighlights,
  deleteJwlibraryHighlight,
  deleteJwlibraryNote,
  updateJwlibraryHighlightColor,
  type BibleVerseHighlight,
} from "@/app/(app)/jwlibrary-actions";
import { notify } from "@/components/ui/toaster";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import { wrapTokenRange, unwrapHighlightMarks } from "@/lib/jwlibrary/paragraph-tokens";
import { toPersonalNotes } from "@/lib/bible/personal-notes";
import {
  useBibleCrossReferences,
  useBibleFootnotesAndStudyNotes,
  useBibleChapterVideos,
  useBibleResearchGuide,
} from "@/hooks/use-bible-study-data";
import { useResearchGuideReference } from "@/hooks/use-research-guide-reference";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { BibleAppendixSurface } from "./bible-appendix-surface";
import { JwpubReferenceSurface } from "./jwpub-reference-surface";
import { JwpubExtractSurface } from "./jwpub-extract-surface";
import { BibleStudyTabs, type BibleStudyTab, type BiblePersonalNote } from "./bible-study-panel";
import {
  JwlibraryNoteEditorVault,
  type EditableJwlibraryNote,
  type PrefilledJwlibraryLocation,
} from "./jwlibrary-note-editor-vault";

// Stable reference for callers (e.g. note-reference-surface.tsx) that don't
// pass `highlights` at all: an inline `highlights = []` default below would
// create a NEW array every render, which — fed straight into the effect a
// few lines down that mirrors props into local state — made that effect's
// dependency change on every render, re-running it, re-triggering the
// re-render, forever. Because that cycle runs through setState-inside-a-
// queueMicrotask rather than setState-during-render, React's own
// "Maximum update depth exceeded" guard (which only watches renders, not
// microtasks) never caught it — it just pegged the tab at 100% CPU with no
// error, indistinguishable from a true infinite loop. Verified empirically:
// reproduced the hang with a real headless Chromium session (even
// `Profiler.stop` over CDP couldn't interrupt it), then confirmed this exact
// line was the cause by bisection.
const EMPTY_HIGHLIGHTS: BibleVerseHighlight[] = [];

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

/** The single verse a range names, or `null` for a superscription-only or multi-verse range — mirrors BibleStudyPanel's "whole chapter vs one verse" scoping. */
function soleVerse(verses: BibleVerseRow[] | null): number | null {
  if (!verses) return null;
  const real = verses.filter((v) => !v.isSuperscription);
  return real.length === 1 ? real[0].verse : null;
}

function VerseText({
  verses,
  isLoading,
  error,
  highlights,
  expandedNoteId,
  onToggleNote,
}: {
  verses: BibleVerseRow[] | null;
  isLoading: boolean;
  error: string | null;
  highlights: BibleVerseHighlight[];
  expandedNoteId: string | null;
  onToggleNote: (noteId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

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

      if (highlight.colorIndex === null || highlight.startToken === null || highlight.endToken === null) {
        if (!highlight.note) continue;
        el.style.position = "relative";
        const marker = document.createElement("span");
        marker.className = "jwlibrary-note-marker";
        marker.dataset.jwlibraryNoteId = highlight.note.id;
        Object.assign(marker.style, {
          position: "absolute",
          left: "-14px",
          top: "0px",
          width: "8px",
          height: "8px",
          borderRadius: "2px",
          backgroundColor: "var(--muted-foreground)",
          cursor: "pointer",
        });
        el.insertBefore(marker, el.firstChild);
        continue;
      }

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(event: MouseEvent) {
      const el = event.target as HTMLElement | null;
      const noteMark = el?.closest<HTMLElement>("[data-jwlibrary-note-id]");
      const noteId = noteMark?.dataset.jwlibraryNoteId;
      if (!noteId) return;
      onToggleNote(noteId);
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [onToggleNote]);

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

/**
 * A verse reference opened from inside a .jwpub publication (jwpub-reader.tsx)
 * or a plain note's Bible reference chip (note-reference-surface.tsx) — same
 * `JwpubSidePanel` shell as footnotes (Vault sheet on mobile, content-pushing
 * panel on desktop), showing the cited verse text PLUS the same six study
 * tabs `/bible`'s own "Estudo" panel has (Refs/Notas/Rodapé/Vídeos/Guia/
 * Pessoal — see BibleStudyTabs in bible-study-panel.tsx), so a citation can be
 * explored without leaving the publication.
 *
 * Fully self-contained: derives book/chapter/verse from the `verses` prop and
 * fetches everything else itself, so neither caller needs to change. Clicking
 * a cross-reference or appendix link inside the tabs re-targets this same
 * panel (fetching the new verse's text + highlights) instead of requiring the
 * host to know about it.
 */
export function JwpubBibleSurface({ open, verses, isLoading, error, onClose, highlights = EMPTY_HIGHLIGHTS }: JwpubBibleSurfaceProps) {
  const [displayVerses, setDisplayVerses] = useState<BibleVerseRow[] | null>(verses);
  const [displayHighlights, setDisplayHighlights] = useState<BibleVerseHighlight[]>(highlights);
  const [displayLoading, setDisplayLoading] = useState(isLoading);
  const [displayError, setDisplayError] = useState<string | null>(error);
  const [tabSelectedVerse, setTabSelectedVerse] = useState<number | null>(soleVerse(verses));
  const [studyTab, setStudyTab] = useState<BibleStudyTab>("referencias");
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [openAppendixId, setOpenAppendixId] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState<EditableJwlibraryNote | null>(null);
  const [pendingNoteLocation, setPendingNoteLocation] = useState<PrefilledJwlibraryLocation | null>(null);

  // Mirrors the parent's own fetch (a new reference clicked in the
  // publication/note) into local state — this effect never fires from an
  // in-panel navigation below, since that only touches local state, not
  // these props.
  useEffect(() => {
    // Deferred a tick — same pattern used throughout this codebase for
    // setState-in-effect (see bible-reader.tsx's identical comments) — rather
    // than set synchronously in the effect body.
    queueMicrotask(() => {
      setDisplayVerses(verses);
      setDisplayHighlights(highlights);
      setDisplayLoading(isLoading);
      setDisplayError(error);
      setTabSelectedVerse(soleVerse(verses));
    });
  }, [verses, highlights, isLoading, error]);

  const [books, setBooks] = useState<BibleBook[]>([]);
  useEffect(() => {
    if (!open || books.length > 0) return;
    void listBibleBooks().then((result) => setBooks(result.books ?? []));
  }, [open, books.length]);

  const viewBookOrder = displayVerses?.[0]?.bookOrder ?? null;
  const viewChapter = displayVerses?.[0]?.chapter ?? null;
  const viewBookName = displayVerses?.[0]?.book ?? "";

  const refreshHighlights = useCallback(() => {
    if (viewBookOrder === null || viewChapter === null) return;
    void getBibleChapterHighlights(viewBookOrder, viewChapter).then((result) =>
      setDisplayHighlights(result.highlights ?? [])
    );
  }, [viewBookOrder, viewChapter]);

  const navigateToVerse = useCallback((bookOrder: number, chapter: number, verse: number) => {
    setOpenAppendixId(null);
    setDisplayLoading(true);
    setDisplayError(null);
    void Promise.all([
      getBibleVerseRange(bookOrder, chapter, verse, verse),
      getBibleChapterHighlights(bookOrder, chapter),
    ]).then(([versesResult, highlightsResult]) => {
      setDisplayVerses(versesResult.verses ?? null);
      setDisplayError(versesResult.error ?? null);
      setDisplayHighlights(highlightsResult.highlights ?? []);
      setTabSelectedVerse(verse);
      setDisplayLoading(false);
    });
  }, []);

  const studyParams = { bookOrder: viewBookOrder, chapter: viewChapter, selectedVerse: tabSelectedVerse, enabled: open };
  const { refs, refsLoading, refsTruncated, refsSource, setRefsSource } = useBibleCrossReferences(studyParams);
  const { footnotes, studyNotes, studyLoading } = useBibleFootnotesAndStudyNotes(studyParams);
  const { videos, videosLoading } = useBibleChapterVideos(studyParams);
  const { researchGuideEntries, researchGuideExtracts, researchGuideLoading } = useBibleResearchGuide(studyParams);

  const {
    referenceOpen,
    referenceTarget,
    referenceHtml,
    isLoadingReference,
    unresolvedPubRef,
    closeReference,
    openPublicationRef,
    handlePublicationRefResolved,
    openExtractIds,
    openExtract: onOpenExtract,
    closeExtract,
  } = useResearchGuideReference(researchGuideEntries);
  const openExtracts = (openExtractIds ?? [])
    .map((id) => researchGuideExtracts[id])
    .filter((extract) => extract !== undefined);

  const personalNotes = toPersonalNotes(displayHighlights, tabSelectedVerse);

  const handleEditPersonalNote = useCallback((note: BiblePersonalNote) => {
    setEditingNote({ id: note.id, title: note.title, content: note.content, userMarkId: note.userMarkId, colorIndex: note.colorIndex });
  }, []);

  const handleDeletePersonalNote = useCallback((note: BiblePersonalNote) => {
    setDisplayHighlights((prev) =>
      prev
        .map((h) => (h.note?.id === note.id ? { ...h, note: null } : h))
        .filter((h) => h.colorIndex !== null || h.note !== null)
    );
    void deleteJwlibraryNote(note.id).then((result) => {
      if (result.error) notify.error("Não foi possível excluir a nota", result.error);
    });
  }, []);

  // Clicking a note-less highlight's own marker (drawn by VerseText above)
  // toggles its color/delete controls the same way tapping it in bible-reader.tsx does.
  const activeHighlight = displayHighlights.find((h) => h.note?.id === expandedNoteId) ?? null;

  const handleColorChangeActiveHighlight = useCallback(
    (colorIndex: number) => {
      if (!activeHighlight) return;
      const id = activeHighlight.id;
      setDisplayHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, colorIndex } : h)));
      void updateJwlibraryHighlightColor(id, colorIndex).then((result) => {
        if (result.error) notify.error("Não foi possível trocar a cor", result.error);
      });
    },
    [activeHighlight]
  );

  const handleDeleteActiveHighlight = useCallback(() => {
    if (!activeHighlight) return;
    const id = activeHighlight.id;
    setDisplayHighlights((prev) => prev.filter((h) => h.id !== id));
    setExpandedNoteId(null);
    void deleteJwlibraryHighlight(id).then((result) => {
      if (result.error) notify.error("Não foi possível excluir o destaque", result.error);
    });
  }, [activeHighlight]);

  return (
    <>
      {/* Was 520 — sized to fit six un-shrunk tabs on one line. Now that the
          tab row scrolls horizontally instead (see BibleStudyTabs), the
          panel itself can go back to the reader's normal side-panel width. */}
      <JwpubSidePanel open={open} title="Referência bíblica" onClose={onClose} width={380}>
        <div className="flex flex-col gap-4">
          <VerseText
            verses={displayVerses}
            isLoading={displayLoading}
            error={displayError}
            highlights={displayHighlights}
            expandedNoteId={expandedNoteId}
            onToggleNote={(noteId) => setExpandedNoteId((prev) => (prev === noteId ? null : noteId))}
          />

          {viewBookOrder !== null && viewChapter !== null && (
            <BibleStudyTabs
              bookName={viewBookName}
              chapter={viewChapter}
              selectedVerse={tabSelectedVerse}
              onClearVerse={() => setTabSelectedVerse(null)}
              onSelectVerse={setTabSelectedVerse}
              refs={refs}
              refsLoading={refsLoading}
              refsTruncated={refsTruncated}
              refsSource={refsSource}
              onChangeRefsSource={setRefsSource}
              books={books}
              onSelectReference={navigateToVerse}
              footnotes={footnotes}
              studyNotes={studyNotes}
              studyLoading={studyLoading}
              onOpenBibleRef={navigateToVerse}
              onOpenAppendix={setOpenAppendixId}
              videos={videos}
              videosLoading={videosLoading}
              researchGuideEntries={researchGuideEntries}
              researchGuideLoading={researchGuideLoading}
              onOpenPublicationRef={openPublicationRef}
              onOpenExtract={onOpenExtract}
              personalNotes={personalNotes}
              onEditPersonalNote={handleEditPersonalNote}
              onDeletePersonalNote={handleDeletePersonalNote}
              activeHighlight={activeHighlight}
              onCloseActiveHighlight={() => setExpandedNoteId(null)}
              onAddNoteToActiveHighlight={() => {
                if (!activeHighlight || viewBookOrder === null || viewChapter === null) return;
                setPendingNoteLocation({
                  blockType: 2,
                  blockIdentifier: activeHighlight.verse,
                  location: {
                    bookNumber: viewBookOrder,
                    chapterNumber: viewChapter,
                    keySymbol: "nwtsty",
                    mepsLanguage: null,
                    issueTagNumber: null,
                    mepsDocumentId: null,
                    track: null,
                    locationType: 0,
                  },
                  label: `${viewBookName} ${viewChapter}:${activeHighlight.verse}`,
                  existingUserMarkId: activeHighlight.id,
                  initialColorIndex: activeHighlight.colorIndex,
                });
              }}
              onColorChangeActiveHighlight={handleColorChangeActiveHighlight}
              onDeleteActiveHighlight={handleDeleteActiveHighlight}
              tab={studyTab}
              onTabChange={setStudyTab}
            />
          )}
        </div>
      </JwpubSidePanel>

      <BibleAppendixSurface
        mepsDocumentId={openAppendixId}
        onClose={() => setOpenAppendixId(null)}
        onOpenAppendix={setOpenAppendixId}
        onOpenBibleRef={navigateToVerse}
      />

      <JwpubReferenceSurface
        open={referenceOpen}
        target={referenceTarget}
        html={referenceHtml}
        isLoading={isLoadingReference}
        unresolvedMepsDocumentId={unresolvedPubRef}
        onResolved={handlePublicationRefResolved}
        onClose={closeReference}
      />

      <JwpubExtractSurface
        open={openExtractIds !== null}
        extracts={openExtracts}
        onClose={closeExtract}
        onOpenSource={openPublicationRef}
      />

      <JwlibraryNoteEditorVault
        open={editingNote !== null || pendingNoteLocation !== null}
        onOpenChange={(next) => {
          if (!next) {
            setEditingNote(null);
            setPendingNoteLocation(null);
          }
        }}
        note={editingNote}
        prefilledLocation={pendingNoteLocation}
        onSaved={() => {
          refreshHighlights();
          setEditingNote(null);
          setPendingNoteLocation(null);
        }}
        onHighlightColorChanged={(userMarkId, colorIndex) => {
          setDisplayHighlights((prev) => prev.map((h) => (h.id === userMarkId ? { ...h, colorIndex } : h)));
        }}
      />
    </>
  );
}
