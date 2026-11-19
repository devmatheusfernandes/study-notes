"use client";

import { useEffect, useRef } from "react";
import { useNotesStore } from "@/lib/store/notes-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { useJwOutbox } from "@/lib/offline/jwlibrary-outbox";
import { listUserContent, type NoteRow, type FolderRow, type TagRow } from "@/app/(app)/notes-actions";
import type { UserPreferencesData } from "@/app/(app)/preferences-actions";

interface StoreHydrationProps {
  /** Server-fetched (RLS-scoped) — see the async (app) layout that renders this. */
  initialNotes: NoteRow[];
  initialFolders: FolderRow[];
  initialTags: TagRow[];
  initialPreferences?: UserPreferencesData;
  /**
   * False when the server's query failed (timeout, transient DB/auth error).
   * The lists are then empty by accident, not by truth — they must never
   * overwrite the locally cached notes/folders.
   */
  contentOk?: boolean;
}

const RETRY_DELAYS_MS = [1500, 4000, 10000, 20000];

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
  contentOk = true,
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
      void Promise.resolve(useNotesStore.persist.rehydrate()).then(async () => {
        if (contentOk) {
          useNotesStore.getState().hydrate(initialNotes, initialFolders, initialTags);
        } else {
          // Keep the local cache and show it; then keep asking the server.
          useNotesStore.setState({ hydrated: true });
          for (const delay of RETRY_DELAYS_MS) {
            await new Promise((r) => setTimeout(r, delay));
            try {
              const fresh = await listUserContent();
              if (fresh.ok) {
                useNotesStore.getState().hydrate(fresh.notes, fresh.folders, fresh.tags);
                break;
              }
            } catch {
              // offline — the local copy stays on screen
            }
          }
        }
        void useNotesStore.getState().syncPendingOps();
      });
    }
    void usePreferencesStore.persist.rehydrate();
    // Highlights, notes and answers written offline in a previous session.
    void Promise.resolve(useJwOutbox.persist.rehydrate()).then(() => useJwOutbox.getState().sync());
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
