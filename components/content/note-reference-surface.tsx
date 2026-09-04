"use client";

import { useEffect, useState } from "react";
import {
  getBibleChapterVerses,
  getBibleVerseRange,
  type BibleVerseRow,
} from "@/app/(app)/bible-actions";
import { resolvePublicationReference } from "@/app/(app)/jwpub-actions";
import { referenceKey, type NoteReference } from "@/lib/notes/note-reference";
import { JwpubBibleSurface } from "./jwpub-bible-surface";
import { JwpubReferenceSurface, type JwpubReferenceTarget } from "./jwpub-reference-surface";

interface NoteReferenceSurfaceProps {
  /** `null` closes the panel. */
  reference: NoteReference | null;
  onClose: () => void;
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
export function NoteReferenceSurface({ reference, onClose }: NoteReferenceSurfaceProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verses, setVerses] = useState<BibleVerseRow[] | null>(null);
  const [target, setTarget] = useState<JwpubReferenceTarget | null>(null);
  const [html, setHtml] = useState<string | null>(null);

  // Keyed on the reference's identity, not the object: clicking the same chip
  // twice (or a re-render handing over an equal-but-new object) must not
  // refetch, while clicking a different one must.
  const key = reference ? referenceKey(reference) : null;

  useEffect(() => {
    if (!reference) return;

    let cancelled = false;
    // Deferred a tick rather than set synchronously in the effect body —
    // the same pattern the reader uses for its own load states.
    queueMicrotask(() => {
      if (cancelled) return;
      setIsLoading(true);
      setError(null);
    });

    async function load(ref: NoteReference) {
      if (ref.kind === "bible") {
        setTarget(null);
        setHtml(null);
        const result =
          ref.startVerse === null
            ? await getBibleChapterVerses(ref.bookOrder, ref.chapter)
            : await getBibleVerseRange(ref.bookOrder, ref.chapter, ref.startVerse, ref.endVerse);
        if (cancelled) return;
        setVerses(result.verses ?? null);
        setError(result.error ?? null);
        return;
      }

      setVerses(null);
      const { reference: resolved, error: resolveError } = await resolvePublicationReference(
        ref.symbol,
        ref.chapter
      );
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
    </>
  );
}
