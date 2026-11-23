"use client";

import { listUserContent } from "@/app/(app)/notes-actions";
import { useNotesStore } from "./notes-store";

const MIN_INTERVAL_MS = 60_000;
let lastRun = Date.now();
let inflight: Promise<void> | null = null;

/**
 * Re-reads the user's own notes/folders/tags and merges them in (the same
 * `hydrate` merge as at startup, so unsynced local edits win). Called when the
 * tab regains focus — that's how a note someone created inside a folder you
 * shared with them shows up without reloading the app. Throttled to once a
 * minute; failures (offline) are silent.
 */
export function refreshOwnContent(): Promise<void> {
  if (inflight || Date.now() - lastRun < MIN_INTERVAL_MS) return inflight ?? Promise.resolve();
  lastRun = Date.now();
  inflight = (async () => {
    try {
      const fresh = await listUserContent();
      if (fresh.ok) useNotesStore.getState().hydrate(fresh.notes, fresh.folders, fresh.tags);
    } catch {
      // offline — the local copy stays
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
