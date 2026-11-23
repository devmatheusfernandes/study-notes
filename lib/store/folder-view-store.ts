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
  /**
   * A folder shared WITH the user that's open in "Compartilhado comigo" (only
   * when they may edit it). Kept apart from `activeFolderId` — that one filters
   * the user's own tree — but new notes go into it all the same.
   */
  sharedFolderId: string | null;
  setSharedFolder: (id: string | null) => void;
}

export const useFolderViewStore = create<FolderViewStore>((set) => ({
  activeFolderId: null,
  setActiveFolder: (activeFolderId) => set({ activeFolderId }),
  sharedFolderId: null,
  setSharedFolder: (sharedFolderId) => set({ sharedFolderId }),
}));

/** Where a note created right now should go: the open shared folder, else the open own folder. */
export function useNewNoteFolderId() {
  return useFolderViewStore((s) => s.sharedFolderId ?? s.activeFolderId);
}
