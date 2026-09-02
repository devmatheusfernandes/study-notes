import { create } from "zustand";
import { persist } from "zustand/middleware";
import { updateUserPreferences, type UserPreferencesData } from "@/app/(app)/preferences-actions";

export type ViewMode = "grid" | "list";

interface PreferencesStore {
  viewMode: ViewMode;
  selectedSourceFilters: string[];
  setViewMode: (mode: ViewMode) => void;
  setSelectedSourceFilters: (filters: string[]) => void;
  hydratePreferences: (prefs: UserPreferencesData) => void;
}

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      viewMode: "grid",
      selectedSourceFilters: ["nota", "pdf", "jwpub", "video"],

      setViewMode: (viewMode) => {
        set({ viewMode });
        void updateUserPreferences({ viewMode });
      },

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
