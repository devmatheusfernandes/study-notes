import { create } from "zustand";

/**
 * Which folder the content screen is currently drilled into.
 * Deliberately NOT persisted — reopening the app should start at the root.
 * Lives in a store (rather than local state) so the header's "+" action and the
 * assistant dock can create things inside the open folder.
 */
interface FolderViewStore {
  activeFolderId: string | null;
  setActiveFolder: (id: string | null) => void;
}

export const useFolderViewStore = create<FolderViewStore>((set) => ({
  activeFolderId: null,
  setActiveFolder: (activeFolderId) => set({ activeFolderId }),
}));
