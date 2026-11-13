"use client";

import { create } from "zustand";

export interface IngestProgress {
  /** What is happening right now, e.g. "Salvando capítulos (40/185)". */
  stage: string;
  /** 0–100, monotonic within one run. */
  percent: number;
}

interface IngestProgressState {
  /** Keyed by the publication's note id — present only while it is being processed. */
  byNote: Record<string, IngestProgress>;
  set: (noteId: string, progress: IngestProgress) => void;
  clear: (noteId: string) => void;
}

/**
 * Live progress of `ingestJwpub`, shared by everything that wants to show it —
 * the reader's reprocess button, its "Processar publicação" state, and the
 * note card — without threading a callback through each of them. Not
 * persisted: a run that is interrupted by a reload simply has no progress.
 */
export const useIngestProgressStore = create<IngestProgressState>((set) => ({
  byNote: {},
  set: (noteId, progress) => set((s) => ({ byNote: { ...s.byNote, [noteId]: progress } })),
  clear: (noteId) =>
    set((s) => {
      if (!(noteId in s.byNote)) return s;
      const next = { ...s.byNote };
      delete next[noteId];
      return { byNote: next };
    }),
}));

/** Progress of one publication's processing, or `undefined` when it isn't being processed. */
export function useIngestProgress(noteId: string | undefined): IngestProgress | undefined {
  return useIngestProgressStore((s) => (noteId ? s.byNote[noteId] : undefined));
}
