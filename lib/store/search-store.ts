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
}

export const useSearchStore = create<SearchStore>((set) => ({
  query: "",
  setQuery: (query) => set({ query }),
}));
