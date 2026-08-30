import { create } from "zustand";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: Array<string>;
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface DeviceStore {
  // PWA State
  deferredPrompt: BeforeInstallPromptEvent | null;
  updateAvailable: boolean;
  isStandalone: boolean;
  registration: ServiceWorkerRegistration | null;
  
  // Device State
  isMobile: boolean;

  // Actions
  setDeferredPrompt: (prompt: BeforeInstallPromptEvent | null) => void;
  setUpdateAvailable: (available: boolean) => void;
  setStandalone: (isStandalone: boolean) => void;
  setRegistration: (reg: ServiceWorkerRegistration | null) => void;
  setIsMobile: (isMobile: boolean) => void;
  
  // Operations
  install: () => Promise<void>;
  update: () => void;
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  deferredPrompt: null,
  updateAvailable: false,
  isStandalone: false,
  registration: null,
  isMobile: false,

  setDeferredPrompt: (prompt) => set({ deferredPrompt: prompt }),
  setUpdateAvailable: (available) => set({ updateAvailable: available }),
  setStandalone: (isStandalone) => set({ isStandalone }),
  setRegistration: (reg) => set({ registration: reg }),
  setIsMobile: (isMobile) => set({ isMobile }),

  install: async () => {
    const { deferredPrompt } = get();
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      set({ deferredPrompt: null });
    }
  },

  update: () => {
    const { registration } = get();
    if (!registration || !registration.waiting) {
      window.location.reload();
      return;
    }

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });

    registration.waiting.postMessage({ type: "SKIP_WAITING" });

    // Fallback: reload page if controllerchange doesn't fire within 2 seconds
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  },
}));

/**
 * Unified hook for Device and PWA state
 */
export function useDevice() {
  const store = useDeviceStore();
  
  return {
    // Device
    isMobile: store.isMobile,
    
    // PWA
    isStandalone: store.isStandalone,
    isInstallable: !!store.deferredPrompt,
    updateAvailable: store.updateAvailable,
    install: store.install,
    update: store.update,
  };
}

// Backward compatibility or for specific mobile usage
export const useIsMobile = () => useDeviceStore((state) => state.isMobile);
