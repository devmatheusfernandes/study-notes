"use client";

import { useEffect, useRef } from "react";
import { useNotesStore } from "@/lib/store/notes-store";

/**
 * /offline is served outside the (app) layout (no <StoreHydration> there), but
 * the sidebar's sync-status card still reads the notes store's persisted
 * `pendingOps` — rehydrate just that from localStorage so the count is
 * accurate here too. No `hydrate()` call: there's no server-fetched notes/folders
 * to merge against on this page, so it deliberately leaves `hydrated: false`.
 */
export function OfflineStoreHydration() {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void useNotesStore.persist.rehydrate();
  }, []);

  return null;
}
