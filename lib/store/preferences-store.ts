import { create } from "zustand";
import { persist } from "zustand/middleware";
import { updateUserPreferences, type UserPreferencesData } from "@/app/(app)/preferences-actions";

export type ViewMode = "grid" | "list";

interface PreferencesStore {
  viewMode: ViewMode;
  /** /jwlibrary's own grid/list preference — deliberately independent of `viewMode` (different page, different card shape) and client-only (no server round trip, unlike `viewMode`): the whole store is already localStorage-persisted via `persist` below, which is enough for this. */
  jwlibraryViewMode: ViewMode;
  selectedSourceFilters: string[];
  /** The user's names for the highlight colours, keyed by color index — follows the account. */
  highlightLabels: Record<string, string>;
  /** An empty label clears it. */
  setHighlightLabel: (colorIndex: number, label: string) => void;
  /** The note's list of headings, kept open beside the text. Client-only, per device (it depends on the screen). */
  showOutline: boolean;
  setShowOutline: (showOutline: boolean) => void;
  /** Handwriting with a stylus only, so a resting palm (or a stray finger) scrolls instead of drawing. Client-only like `jwlibraryViewMode`, and deliberately so: whether there's a pen is a property of *this device*, not of the account. Auto-enables the first time a real pen event arrives. */
  penOnly: boolean;
  /** RSVP speed reader: words per minute, and whether it runs continuously ("flow") or stops at the end of every verse/paragraph ("study"). Client-only, per device. */
  rsvpWpm: number;
  rsvpMode: "flow" | "study";
  setRsvpWpm: (wpm: number) => void;
  setRsvpMode: (mode: "flow" | "study") => void;
  setViewMode: (mode: ViewMode) => void;
  setJwlibraryViewMode: (mode: ViewMode) => void;
  setPenOnly: (penOnly: boolean) => void;
  setSelectedSourceFilters: (filters: string[]) => void;
  hydratePreferences: (prefs: UserPreferencesData) => void;
}

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set, get) => ({
      viewMode: "grid",
      jwlibraryViewMode: "list",
      selectedSourceFilters: ["nota", "pdf", "jwpub", "video", "estudo_pessoal", "biblia"],
      highlightLabels: {},
      setHighlightLabel: (colorIndex, label) => {
        const highlightLabels = { ...get().highlightLabels };
        if ((highlightLabels[colorIndex] ?? "") === label) return;
        if (label) highlightLabels[colorIndex] = label;
        else delete highlightLabels[colorIndex];
        set({ highlightLabels });
        // Offline: it stays on this device.
        void updateUserPreferences({ highlightLabels }).catch(() => {});
      },
      // On by default: a stylus is the common reason to open the pen at all, and with it off a resting palm draws.
      penOnly: true,
      rsvpWpm: 300,
      rsvpMode: "flow",

      setRsvpWpm: (rsvpWpm) => set({ rsvpWpm: Math.min(1000, Math.max(100, Math.round(rsvpWpm))) }),
      setRsvpMode: (rsvpMode) => set({ rsvpMode }),

      setViewMode: (viewMode) => {
        set({ viewMode });
        void updateUserPreferences({ viewMode });
      },

      setJwlibraryViewMode: (jwlibraryViewMode) => set({ jwlibraryViewMode }),

      setPenOnly: (penOnly) => set({ penOnly }),

      showOutline: false,
      setShowOutline: (showOutline) => set({ showOutline }),

      setSelectedSourceFilters: (selectedSourceFilters) => {
        set({ selectedSourceFilters });
        void updateUserPreferences({ selectedSourceFilters });
      },

      hydratePreferences: (prefs) => {
        set((state) => ({
          viewMode: prefs.viewMode ?? state.viewMode,
          selectedSourceFilters: prefs.selectedSourceFilters ?? state.selectedSourceFilters,
          highlightLabels: prefs.highlightLabels ?? state.highlightLabels,
        }));
      },
    }),
    {
      name: "study-notes:preferences",
      skipHydration: true,
      // v1 flips the default to pen-only; a device that stored the old `false` is carried over too.
      version: 1,
      migrate: (persisted) => ({ ...(persisted as object), penOnly: true }),
    }
  )
);
