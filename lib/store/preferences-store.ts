import { create } from "zustand";
import { persist } from "zustand/middleware";
import { updateUserPreferences, type UserPreferencesData } from "@/app/(app)/preferences-actions";

export type ViewMode = "grid" | "list";

interface PreferencesStore {
  viewMode: ViewMode;
  /** /jwlibrary's own grid/list preference — deliberately independent of `viewMode` (different page, different card shape) and client-only (no server round trip, unlike `viewMode`): the whole store is already localStorage-persisted via `persist` below, which is enough for this. */
  jwlibraryViewMode: ViewMode;
  selectedSourceFilters: string[];
  setViewMode: (mode: ViewMode) => void;
  setJwlibraryViewMode: (mode: ViewMode) => void;
  setSelectedSourceFilters: (filters: string[]) => void;
  hydratePreferences: (prefs: UserPreferencesData) => void;
}

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      viewMode: "grid",
      jwlibraryViewMode: "list",
      selectedSourceFilters: ["nota", "pdf", "jwpub", "video", "estudo_pessoal", "biblia"],

      setViewMode: (viewMode) => {
        set({ viewMode });
        void updateUserPreferences({ viewMode });
      },

      setJwlibraryViewMode: (jwlibraryViewMode) => set({ jwlibraryViewMode }),

      setSelectedSourceFilters: (selectedSourceFilters) => {
        set({ selectedSourceFilters });
        void updateUserPreferences({ selectedSourceFilters });
      },

      hydratePreferences: (prefs) => {
        set((state) => ({
          viewMode: prefs.viewMode ?? state.viewMode,
          selectedSourceFilters: prefs.selectedSourceFilters ?? state.selectedSourceFilters,
        }));
      },
    }),
    { name: "study-notes:preferences", skipHydration: true }
  )
);
