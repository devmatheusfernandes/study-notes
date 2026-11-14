import { create } from "zustand";

interface ChatDockStore {
  /** The conversation pinned to the side, or null when the dock is closed. */
  conversationId: string | null;
  dock: (conversationId: string) => void;
  close: () => void;
}

/**
 * In-memory on purpose: the dock shows whatever `useChatStore` holds, and that
 * store isn't persisted either, so a reload starts without it.
 */
export const useChatDockStore = create<ChatDockStore>((set) => ({
  conversationId: null,
  dock: (conversationId) => set({ conversationId }),
  close: () => set((s) => (s.conversationId === null ? s : { conversationId: null })),
}));
