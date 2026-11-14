"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { ParagraphHighlight } from "@/app/(app)/jwlibrary-actions";
import type { JwlibraryLocation } from "@/lib/jwlibrary/types";
import type { HighlightClick } from "@/lib/jwlibrary/draw-highlights";
import { queueCreateHighlight } from "@/lib/offline/jwlibrary-mutations";
import { useDocumentHighlights } from "@/hooks/use-document-highlights";
import { JwlibraryHighlightNotePanel } from "./jwlibrary-highlight-note-panel";
import {
  JwlibraryNoteEditorVault,
  type EditableJwlibraryNote,
  type PrefilledJwlibraryLocation,
} from "./jwlibrary-note-editor-vault";

/** MEPS language index for Portuguese — what the app's shared reference works (appendices, Perspicaz, Guia) are published in. */
export const PORTUGUESE_MEPS_LANGUAGE = 5;

/** Where a mark on `mepsDocumentId` is filed, the way an imported JW Library backup files one. */
export function documentLocation(
  keySymbol: string,
  mepsDocumentId: number,
  mepsLanguage: number = PORTUGUESE_MEPS_LANGUAGE
): JwlibraryLocation {
  return {
    bookNumber: null,
    chapterNumber: null,
    keySymbol,
    mepsLanguage,
    issueTagNumber: 0,
    mepsDocumentId,
    track: null,
    locationType: 0,
  };
}

export interface DocumentAnnotations {
  /** Spread onto `<HighlightableHtml>`. */
  htmlProps: {
    highlights: ParagraphHighlight[];
    onHighlightClick: (click: HighlightClick) => void;
    onCreateHighlight: (pid: string, startToken: number, endToken: number, colorIndex: number) => void;
    onPickSpan: (pid: string, startToken: number, endToken: number, selectedText: string) => void;
  };
  /**
   * The note panel and the note editor. Must be rendered as a flex sibling of
   * the page's main column — the desktop side panel is one (see JwpubSidePanel).
   */
  panels: ReactNode;
}

/**
 * Everything a full-page reader of a shared document (an appendix, a Perspicaz
 * article, a Guia topic) needs to let the user highlight and annotate it —
 * the same flow as the publication reader, minus the publication: pick a
 * colour under a selection, click a mark to recolour/annotate/delete it, click
 * a note's square to read it in the side panel.
 */
export function useDocumentAnnotations(location: JwlibraryLocation | null, label: string): DocumentAnnotations {
  const mepsDocumentId = location?.mepsDocumentId ?? null;
  const { highlights, setHighlights, refresh } = useDocumentHighlights(mepsDocumentId);

  const [pendingNoteLocation, setPendingNoteLocation] = useState<PrefilledJwlibraryLocation | null>(null);
  const [highlightNote, setHighlightNote] = useState<EditableJwlibraryNote | null>(null);
  const [highlightEditMode, setHighlightEditMode] = useState(false);
  const [highlightMark, setHighlightMark] = useState<(ParagraphHighlight & { text?: string }) | null>(null);
  const [raiseKey, setRaiseKey] = useState(0);

  const onCreateHighlight = useCallback(
    (pid: string, startToken: number, endToken: number, colorIndex: number) => {
      if (!location) return;
      // Chosen client-side and sent through the offline outbox, so the mark is
      // a real, clickable highlight the moment it appears.
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
    [location, setHighlights]
  );

  const onPickSpan = useCallback(
    (pid: string, startToken: number, endToken: number, selectedText: string) => {
      if (!location) return;
      setPendingNoteLocation({
        blockType: 1,
        blockIdentifier: Number(pid),
        location,
        label,
        tokenRange: { start: startToken, end: endToken },
        selectedText,
      });
    },
    [location, label]
  );

  const onHighlightClick = useCallback((click: HighlightClick) => {
    setRaiseKey((n) => n + 1);
    if (click.kind === "note") {
      const { highlight } = click;
      if (!highlight.note) return;
      // `note:<id>` is a placeholder for a note with no UserMark (see ParagraphHighlight).
      const hasRealMark = highlight.colorIndex !== null;
      setHighlightNote({
        ...highlight.note,
        userMarkId: hasRealMark ? highlight.id : null,
        colorIndex: highlight.colorIndex,
      });
    } else {
      setHighlightMark({ ...click.highlight, text: click.text });
    }
  }, []);

  const handleAddNoteToHighlight = useCallback(() => {
    if (!highlightMark || !location) return;
    setPendingNoteLocation({
      blockType: 1,
      blockIdentifier: Number(highlightMark.pid),
      location,
      label,
      existingUserMarkId: highlightMark.id,
      initialColorIndex: highlightMark.colorIndex,
    });
    setHighlightMark(null);
  }, [highlightMark, location, label]);

  const panels = (
    <>
      <JwlibraryHighlightNotePanel
        open={(highlightNote !== null || highlightMark !== null) && !highlightEditMode}
        note={highlightNote}
        highlightId={highlightMark?.id}
        colorIndex={highlightMark?.colorIndex}
        highlightText={highlightMark?.text}
        onClose={() => {
          setHighlightNote(null);
          setHighlightMark(null);
        }}
        raiseKey={raiseKey}
        onEdit={() => setHighlightEditMode(true)}
        onAddNote={handleAddNoteToHighlight}
        onColorChanged={(colorIndex) => {
          const id = highlightMark?.id;
          setHighlightMark((prev) => (prev ? { ...prev, colorIndex } : prev));
          if (id) setHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, colorIndex } : h)));
        }}
        onDeleted={() => {
          // Patched in place rather than refetched: the delete is still in the
          // outbox, so the server would hand the deleted entry straight back.
          const noteId = highlightNote?.id;
          const markId = highlightMark?.id;
          setHighlights((prev) =>
            noteId
              ? prev.flatMap((h) => (h.note?.id !== noteId ? [h] : h.colorIndex === null ? [] : [{ ...h, note: null }]))
              : prev.filter((h) => h.id !== markId)
          );
          setHighlightNote(null);
          setHighlightMark(null);
        }}
      />

      <JwlibraryNoteEditorVault
        open={pendingNoteLocation !== null || (highlightNote !== null && highlightEditMode)}
        onOpenChange={(next) => {
          if (!next) {
            setPendingNoteLocation(null);
            setHighlightNote(null);
            setHighlightEditMode(false);
          }
        }}
        note={highlightEditMode ? highlightNote : null}
        prefilledLocation={pendingNoteLocation}
        onSaved={() => void refresh()}
        onHighlightColorChanged={(userMarkId, colorIndex) => {
          setHighlights((prev) => prev.map((h) => (h.id === userMarkId ? { ...h, colorIndex } : h)));
        }}
      />
    </>
  );

  return {
    htmlProps: { highlights, onHighlightClick, onCreateHighlight, onPickSpan },
    panels,
  };
}
