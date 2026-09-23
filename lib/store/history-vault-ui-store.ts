import { create } from "zustand";

/**
 * Whether the navigation-history Vault (<HistoryVaultButton>) is open.
 * Deliberately NOT persisted, and deliberately a store rather than local
 * component state: the button that OPENS it can be either the standalone
 * header icon (when there's room) or an item inside UserMenuClient's
 * dropdown (when there isn't) — two components in different trees that need
 * to share one open/close flag without prop-drilling through every header.
 */
interface HistoryVaultUiStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useHistoryVaultUiStore = create<HistoryVaultUiStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
