import { create } from "zustand";

interface SidebarStore {
  mobileOpen: boolean;
  desktopCollapsed: boolean;
  openMobile: () => void;
  closeMobile: () => void;
  toggleDesktop: () => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  mobileOpen: false,
  desktopCollapsed: false,
  openMobile: () => set({ mobileOpen: true }),
  closeMobile: () => set({ mobileOpen: false }),
  toggleDesktop: () => set((s) => ({ desktopCollapsed: !s.desktopCollapsed })),
}));
