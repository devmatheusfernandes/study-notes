import { create } from "zustand";

/**
 * The header search box's query — lives in a store (not local state) because
 * the header and the notes/folders list it filters are sibling components on
 * the page, not parent/child. Deliberately not persisted or reset on
 * navigation: carrying a search across notes/archived/trash mirrors how the
 * rest of the header (folder drill-down, view mode) already behaves.
 */
interface SearchStore {
  query: string;
  setQuery: (query: string) => void;
  /** Tag ids picked in the header's tag filter panel — OR semantics: a note matches if it has any of these. */
  selectedTagIds: string[];
  toggleTagFilter: (id: string) => void;
  clearTagFilter: () => void;
}

export const useSearchStore = create<SearchStore>((set) => ({
  query: "",
  setQuery: (query) => set({ query }),
  selectedTagIds: [],
  toggleTagFilter: (id) =>
    set((s) => ({
      selectedTagIds: s.selectedTagIds.includes(id)
        ? s.selectedTagIds.filter((t) => t !== id)
        : [...s.selectedTagIds, id],
    })),
  clearTagFilter: () => set({ selectedTagIds: [] }),
}));
