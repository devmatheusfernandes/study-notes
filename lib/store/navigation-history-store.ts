import { create } from "zustand";
import { persist } from "zustand/middleware";

export type HistoryEntryType = "note" | "publication" | "bible";

export interface HistoryEntry {
  /**
   * Dedup/identity key — a note's id for "note"/"publication" entries, or
   * `bible:{bookOrder}:{chapter}` for a Bible chapter. Re-visiting an id
   * already in the list moves it back to the front instead of adding a
   * second row for the same note/chapter.
   */
  id: string;
  type: HistoryEntryType;
  title: string;
  /** e.g. a folder name, or the chapter within a publication — shown as secondary text. */
  subtitle?: string;
  href: string;
  visitedAt: number;
}

/** Plenty to be useful as a "jump back to where I was" list without the Vault turning into a second notes screen. */
const MAX_HISTORY_ENTRIES = 40;

interface NavigationHistoryStore {
  entries: HistoryEntry[];
  recordVisit: (entry: Omit<HistoryEntry, "visitedAt">) => void;
  clear: () => void;
}

/**
 * A rolling, most-recent-first log of notes/publications/Bible chapters the
 * user has opened, surfaced by <HistoryVaultButton> next to the avatar in
 * every header. Persisted to localStorage like the rest of the client-only
 * stores (preferences-store, folder-view-store) — this is a per-device
 * convenience list, not data that needs to sync across devices or survive
 * a signed-out/signed-in swap, so it deliberately isn't a DB table.
 */
export const useNavigationHistoryStore = create<NavigationHistoryStore>()(
  persist(
    (set) => ({
      entries: [],

      recordVisit: (entry) =>
        set((s) => ({
          entries: [
            { ...entry, visitedAt: Date.now() },
            ...s.entries.filter((e) => e.id !== entry.id),
          ].slice(0, MAX_HISTORY_ENTRIES),
        })),

      clear: () => set({ entries: [] }),
    }),
    { name: "study-notes:nav-history" }
  )
);
