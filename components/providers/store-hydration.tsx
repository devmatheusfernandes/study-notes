"use client";

import { useEffect, useRef } from "react";
import { useNotesStore } from "@/lib/store/notes-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { useJwOutbox } from "@/lib/offline/jwlibrary-outbox";
import { listUserContent } from "@/app/(app)/notes-actions";
import { getUserPreferences } from "@/app/(app)/preferences-actions";

const RETRY_DELAYS_MS = [1500, 4000, 10000, 20000];

/**
 * Seeds the notes store and the preferences, entirely client-side.
 *
 * The (app) layout deliberately does NOT fetch this data: awaiting it there
 * made the whole subtree dynamic, so a client-side navigation (e.g. to
 * /notes/new) needed a server round trip and a session that started offline
 * showed nothing. The layout is now a static shell; the persisted local copy
 * (and its outbox) is what paints first, and the server copy is merged in
 * once reachable.
 */
export function StoreHydration() {
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true;

      void (async () => {
        // Load whatever was persisted locally (including any still-unsynced
        // drafts and their pending outbox entries) before merging in the
        // server rows, so `hydrate()` knows which ids to keep local.
        await Promise.resolve(useNotesStore.persist.rehydrate());
        const local = useNotesStore.getState();
        // Something cached → show it now. Nothing cached (first visit on this
        // device) → stay in the loading state until the server answers, so an
        // empty list isn't mistaken for "no notes".
        if (local.notes.length > 0 || local.folders.length > 0) useNotesStore.setState({ hydrated: true });

        for (let attempt = 0; ; attempt += 1) {
          try {
            const fresh = await listUserContent();
            if (fresh.ok) {
              useNotesStore.getState().hydrate(fresh.notes, fresh.folders, fresh.tags);
              break;
            }
          } catch {
            // Offline: the local copy stays on screen.
          }
          if (attempt >= RETRY_DELAYS_MS.length) {
            useNotesStore.setState({ hydrated: true });
            break;
          }
          // Out of attempts' patience for the first paint: show what we have.
          if (attempt === 0) useNotesStore.setState({ hydrated: true });
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
        void useNotesStore.getState().syncPendingOps();
      })();

      void getUserPreferences()
        .then((prefs) => usePreferencesStore.getState().hydratePreferences(prefs))
        .catch(() => {});
    }
    void usePreferencesStore.persist.rehydrate();
    // Highlights, notes and answers written offline in a previous session.
    void Promise.resolve(useJwOutbox.persist.rehydrate()).then(() => useJwOutbox.getState().sync());
  }, []);

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
