import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ViewMode = "grid" | "list";

interface PreferencesStore {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      viewMode: "grid",
      setViewMode: (viewMode) => set({ viewMode }),
    }),
    { name: "study-notes:preferences", skipHydration: true }
  )
);
