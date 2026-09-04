import { create } from "zustand";

/**
 * Multi-select state for bulk actions on /jwlibrary notes. Deliberately a
 * separate store from lib/store/selection-store.ts (used by /notes) rather
 * than the same global instance — the two screens are unrelated, and sharing
 * one store would leak a /notes selection into /jwlibrary (and vice versa)
 * since neither page clears the other's state on navigation.
 */
interface JwlibrarySelectionStore {
  selectedIds: string[];
  visibleIds: string[];
  setVisibleIds: (ids: string[]) => void;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
}

export const useJwlibrarySelectionStore = create<JwlibrarySelectionStore>((set, get) => ({
  selectedIds: [],
  visibleIds: [],
  setVisibleIds: (visibleIds) => set({ visibleIds }),
  isSelected: (id) => get().selectedIds.includes(id),
  toggle: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  selectAll: () => set((s) => ({ selectedIds: [...s.visibleIds] })),
  clear: () => set({ selectedIds: [] }),
}));
