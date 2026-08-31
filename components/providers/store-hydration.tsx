"use client";

import { useEffect, useState } from "react";
import { useNotesStore } from "@/lib/store/notes-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";

/**
 * The persisted stores use `skipHydration` so the server and the first client
 * render always agree (localStorage isn't available on the server). We rehydrate
 * them here, after mount, instead.
 */
export function StoreHydration() {
  useEffect(() => {
    void useNotesStore.persist.rehydrate();
    void usePreferencesStore.persist.rehydrate();
  }, []);

  return null;
}

/** True only after the client has mounted — use to defer persisted-state-dependent UI. */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
