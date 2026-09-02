"use client";

import { useEffect, useRef } from "react";
import { useNotesStore } from "@/lib/store/notes-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import type { NoteRow, FolderRow, TagRow } from "@/app/(app)/notes-actions";
import type { UserPreferencesData } from "@/app/(app)/preferences-actions";

interface StoreHydrationProps {
  /** Server-fetched (RLS-scoped) — see the async (app) layout that renders this. */
  initialNotes: NoteRow[];
  initialFolders: FolderRow[];
  initialTags: TagRow[];
  initialPreferences?: UserPreferencesData;
}

/**
 * Seeds the notes store from data fetched server-side, and rehydrates the
 * preferences store. Both only run client-side — the server and first client
 * render intentionally start from the same state, so there's no hydration mismatch.
 */
export function StoreHydration({
  initialNotes,
  initialFolders,
  initialTags,
  initialPreferences,
}: StoreHydrationProps) {
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true;
      if (initialPreferences) {
        usePreferencesStore.getState().hydratePreferences(initialPreferences);
      }
      // Load whatever was persisted locally (including any still-unsynced
      // drafts and their pending outbox entries) before merging in the
      // server-fetched rows, so `hydrate()` knows which ids to keep local.
      void useNotesStore.persist.rehydrate()?.then(() => {
        useNotesStore.getState().hydrate(initialNotes, initialFolders, initialTags);
        void useNotesStore.getState().syncPendingOps();
      });
    }
    void usePreferencesStore.persist.rehydrate();
  }, [initialNotes, initialFolders, initialTags, initialPreferences]);

  return null;
}

/**
 * True once the notes store has real data seeded into it. Tied directly to
 * the store's own `hydrated` flag (not "has some component mounted") because
 * child effects fire before parent effects — a mount-based flag in a child
 * could flip true before `StoreHydration`, a parent, has actually run.
 */
export function useHydrated() {
  return useNotesStore((s) => s.hydrated);
}
