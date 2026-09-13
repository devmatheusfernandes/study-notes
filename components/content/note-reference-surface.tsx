"use client";

import { useEffect, useState } from "react";
import {
  getBibleChapterVerses,
  getBibleVerseRange,
  type BibleVerseRow,
} from "@/app/(app)/bible-actions";
import { resolvePublicationReference, resolvePublicationChapterById } from "@/app/(app)/jwpub-actions";
import { getGlobalVideoById } from "@/app/(app)/global-video-actions";
import { referenceKey, type NoteReference } from "@/lib/notes/note-reference";
import { useNotesStore } from "@/lib/store/notes-store";
import { JwpubBibleSurface } from "./jwpub-bible-surface";
import { JwpubReferenceSurface, type JwpubReferenceTarget } from "./jwpub-reference-surface";
import { NoteVideoSurface, type NoteVideoTarget } from "./note-video-surface";
import { NoteLinkSurface } from "./note-link-surface";

interface NoteReferenceSurfaceProps {
  /** `null` closes the panel. */
  reference: NoteReference | null;
  onClose: () => void;
  /** Navigates to a linked note's own editor — called from the "note" surface's "Abrir nota" button. */
  onOpenNote: (noteId: string) => void;
}

/**
 * Opens whatever reference the user clicked inside a note body, in the same
 * two surfaces the .jwpub reader already uses — `JwpubBibleSurface` for
 * scripture, `JwpubReferenceSurface` for a publication chapter — so a
 * reference behaves identically whether it was typed into a note or found
 * inside a publication.
 *
 * Fetching lives here rather than in the note editor so the editor keeps
 * exactly one piece of state for this feature (which reference is open).
 */
export function NoteReferenceSurface({ reference, onClose, onOpenNote }: NoteReferenceSurfaceProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verses, setVerses] = useState<BibleVerseRow[] | null>(null);
  const [target, setTarget] = useState<JwpubReferenceTarget | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [video, setVideo] = useState<NoteVideoTarget | null>(null);

  // A linked note is already sitting in the offline-first store (see
  // note-editor.tsx's own comment on noteMentionOptions) — no fetch, no
  // loading state, just a live selector so a title edited elsewhere updates
  // the panel immediately.
  const linkedNote = useNotesStore((s) =>
    reference?.kind === "note" ? s.notes.find((n) => n.id === reference.noteId) : undefined
  );

  // Keyed on the reference's identity, not the object: clicking the same chip
  // twice (or a re-render handing over an equal-but-new object) must not
  // refetch, while clicking a different one must.
  const key = reference ? referenceKey(reference) : null;

  useEffect(() => {
    if (!reference || reference.kind === "note") return;

    let cancelled = false;
    // Deferred a tick rather than set synchronously in the effect body —
    // the same pattern the reader uses for its own load states.
    queueMicrotask(() => {
      if (cancelled) return;
      setIsLoading(true);
      setError(null);
    });

    async function load(ref: NoteReference) {
      if (ref.kind === "note") return; // handled by the linkedNote selector above, no fetch needed

      if (ref.kind === "bible") {
        setTarget(null);
        setHtml(null);
        setVideo(null);
        const result =
          ref.startVerse === null
            ? await getBibleChapterVerses(ref.bookOrder, ref.chapter)
            : await getBibleVerseRange(ref.bookOrder, ref.chapter, ref.startVerse, ref.endVerse);
        if (cancelled) return;
        setVerses(result.verses ?? null);
        setError(result.error ?? null);
        return;
      }

      if (ref.kind === "video") {
        setVerses(null);
        setTarget(null);
        setHtml(null);
        const row = await getGlobalVideoById(ref.videoId);
        if (cancelled) return;
        if (!row) {
          setVideo(null);
          setError("Vídeo não encontrado.");
          return;
        }
        setVideo({
          videoId: row.id,
          title: row.title,
          videoUrl: row.video_url ?? undefined,
          coverImage: row.cover_image ?? undefined,
          durationFormatted: row.duration_formatted ?? undefined,
          subtitlesUrl: row.subtitles_url ?? undefined,
        });
        setError(null);
        return;
      }

      setVerses(null);
      setVideo(null);
      const { reference: resolved, error: resolveError } =
        ref.documentId !== undefined && ref.publicationId
          ? await resolvePublicationChapterById(ref.publicationId, ref.documentId, !!ref.isGlobal)
          : await resolvePublicationReference(ref.symbol, ref.chapter);
      if (cancelled) return;
      if (!resolved) {
        setTarget(null);
        setHtml(null);
        setError(resolveError ?? "Referência não encontrada.");
        return;
      }
      setTarget({
        noteId: resolved.noteId,
        publicationTitle: resolved.publicationTitle,
        chapterTitle: resolved.chapterTitle,
        documentId: resolved.documentId,
      });
      setHtml(resolved.html);
    }

    void load(reference).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // `reference` is intentionally not a dependency — `key` is its identity,
    // and depending on the object itself would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <>
      <JwpubBibleSurface
        open={reference?.kind === "bible"}
        verses={verses}
        error={error}
        isLoading={isLoading}
        onClose={onClose}
      />
      <JwpubReferenceSurface
        open={reference?.kind === "publication"}
        target={target}
        html={html}
        error={error}
        isLoading={isLoading}
        onClose={onClose}
      />
      <NoteVideoSurface
        open={reference?.kind === "video"}
        video={video}
        error={error}
        isLoading={isLoading}
        onClose={onClose}
      />
      <NoteLinkSurface
        open={reference?.kind === "note"}
        note={linkedNote ?? null}
        fallbackTitle={reference?.kind === "note" ? reference.title : ""}
        onOpen={() => linkedNote && onOpenNote(linkedNote.id)}
        onClose={onClose}
      />
    </>
  );
}
