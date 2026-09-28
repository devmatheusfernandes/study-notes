"use client";

import { useEffect, useState } from "react";
import { referenceKey, type NoteReference } from "@/lib/notes/note-reference";
import {
  cachedNoteReference,
  resolveNoteReference,
  type ResolvedReference,
} from "@/lib/notes/reference-resolver";
import { useNotesStore } from "@/lib/store/notes-store";
import { JwpubBibleSurface } from "./jwpub-bible-surface";
import { JwpubReferenceSurface } from "./jwpub-reference-surface";
import { NoteVideoSurface } from "./note-video-surface";
import { NoteLinkSurface } from "./note-link-surface";

interface NoteReferenceSurfaceProps {
  /** `null` closes the panel. */
  reference: NoteReference | null;
  onClose: () => void;
  /** Navigates to a linked note's own editor — called from the "note" surface's "Abrir nota" button. */
  onOpenNote: (noteId: string) => void;
}

const EMPTY: ResolvedReference = { verses: null, target: null, html: null, video: null, error: null };

/**
 * Opens whatever reference the user clicked inside a note body, in the same
 * two surfaces the .jwpub reader already uses — `JwpubBibleSurface` for
 * scripture, `JwpubReferenceSurface` for a publication chapter — so a
 * reference behaves identically whether it was typed into a note or found
 * inside a publication.
 *
 * Resolution itself lives in lib/notes/reference-resolver.ts (cached and
 * de-duplicated there, and warmed on hover by rich-text-editor.tsx), so this
 * component only decides *which* panel is open and hands it the result.
 */
export function NoteReferenceSurface({ reference, onClose, onOpenNote }: NoteReferenceSurfaceProps) {
  const [resolved, setResolved] = useState<ResolvedReference>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);

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

  // A reference that's already cached (opened before, or warmed by hover) is
  // applied *during render* rather than from the effect below — React's
  // documented "adjust state when a prop changes" pattern. That's what makes
  // a second open paint the text in the same commit that opens the panel,
  // with no skeleton frame in between.
  const cached = cachedNoteReference(reference);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  if (cached && key !== null && appliedKey !== key) {
    setAppliedKey(key);
    setResolved(cached);
    setIsLoading(false);
  }

  useEffect(() => {
    if (!reference || reference.kind === "note") return;
    if (cachedNoteReference(reference)) return; // applied synchronously above

    let cancelled = false;
    // Deferred a tick rather than set synchronously in the effect body —
    // the same pattern the reader uses for its own load states. The previous
    // reference's content is cleared in the same go, so a slow fetch never
    // shows the *last* reference's text under the new one's title.
    queueMicrotask(() => {
      if (cancelled) return;
      setResolved(EMPTY);
      setIsLoading(true);
    });

    resolveNoteReference(reference)
      .then((next) => {
        if (cancelled) return;
        setAppliedKey(key);
        setResolved(next);
      })
      .catch(() => {
        if (cancelled) return;
        setResolved({ ...EMPTY, error: "Sem conexão para carregar esta referência." });
      })
      .finally(() => {
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
        verses={resolved.verses}
        error={resolved.error}
        isLoading={isLoading}
        onClose={onClose}
      />
      <JwpubReferenceSurface
        open={reference?.kind === "publication"}
        target={resolved.target}
        html={resolved.html}
        error={resolved.error}
        isLoading={isLoading}
        onClose={onClose}
      />
      <NoteVideoSurface
        open={reference?.kind === "video"}
        video={resolved.video}
        error={resolved.error}
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
