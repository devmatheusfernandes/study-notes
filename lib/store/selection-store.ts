import { create } from "zustand";

/** Multi-select state for bulk actions on notes/files. Deliberately not persisted. */
interface SelectionStore {
  selectedIds: string[];
  /** Ids currently rendered by `NotesCollection`, kept in sync so "select all" knows what "all" means. */
  visibleIds: string[];
  setVisibleIds: (ids: string[]) => void;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionStore>((set, get) => ({
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
