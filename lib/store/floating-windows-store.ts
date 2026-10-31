import { create } from "zustand";
import type { BibleVerseRow } from "@/app/(app)/bible-actions";
import type { BibleVerseHighlight } from "@/app/(app)/jwlibrary-actions";

/**
 * Floating reference windows (desktop and tablet): a Bible passage pulled out
 * of the side panel into its own window that can be moved, resized and kept
 * open next to the text while reading. Several can be open at once.
 *
 * Deliberately not persisted — a window is a reading aid for this sitting, and
 * its rectangle is only meaningful for the screen it was opened on.
 */

export interface FloatingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloatingBibleWindow extends FloatingRect {
  id: string;
  /** Identifies the passage, so asking for the same one again surfaces its window instead of opening a twin. */
  passageKey: string;
  verses: BibleVerseRow[];
  highlights: BibleVerseHighlight[];
  /** Stacking order — higher is in front. */
  z: number;
}

export const MIN_WINDOW_WIDTH = 300;
export const MIN_WINDOW_HEIGHT = 220;
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 540;
const MAX_WINDOWS = 8;
const CASCADE_STEP = 28;

interface FloatingWindowsStore {
  windows: FloatingBibleWindow[];
  nextZ: number;
  openBibleWindow: (passage: { verses: BibleVerseRow[]; highlights: BibleVerseHighlight[] }) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  setRect: (id: string, rect: Partial<FloatingRect>) => void;
}

function passageKey(verses: BibleVerseRow[]): string {
  return `${verses[0]?.id ?? "?"}-${verses[verses.length - 1]?.id ?? "?"}`;
}

/** Keeps a rectangle reachable: its title bar stays on screen and it never outgrows the viewport. */
export function clampRect(rect: FloatingRect, viewport: { width: number; height: number }): FloatingRect {
  const w = Math.min(Math.max(rect.w, MIN_WINDOW_WIDTH), Math.max(MIN_WINDOW_WIDTH, viewport.width));
  const h = Math.min(Math.max(rect.h, MIN_WINDOW_HEIGHT), Math.max(MIN_WINDOW_HEIGHT, viewport.height));
  const grip = 96; // how much of a window must stay on screen horizontally
  return {
    w,
    h,
    x: Math.min(Math.max(rect.x, grip - w), viewport.width - grip),
    y: Math.min(Math.max(rect.y, 0), Math.max(0, viewport.height - 48)),
  };
}

function viewport() {
  return typeof window === "undefined" ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight };
}

export const useFloatingWindowsStore = create<FloatingWindowsStore>((set, get) => ({
  windows: [],
  nextZ: 1,

  openBibleWindow: ({ verses, highlights }) => {
    if (verses.length === 0) return;
    const key = passageKey(verses);
    const existing = get().windows.find((w) => w.passageKey === key);
    if (existing) {
      get().focus(existing.id);
      return;
    }

    const vp = viewport();
    const cascade = get().windows.length % 6;
    const w = Math.min(DEFAULT_WIDTH, vp.width - 48);
    const h = Math.min(DEFAULT_HEIGHT, vp.height - 96);
    const rect = clampRect(
      { w, h, x: vp.width - w - 32 - cascade * CASCADE_STEP, y: 88 + cascade * CASCADE_STEP },
      vp
    );

    set((s) => {
      // Past the cap the oldest window makes room — a stack of eight is already more than fits on screen.
      const kept = s.windows.length >= MAX_WINDOWS ? s.windows.slice(1) : s.windows;
      return {
        windows: [...kept, { id: crypto.randomUUID(), passageKey: key, verses, highlights, ...rect, z: s.nextZ }],
        nextZ: s.nextZ + 1,
      };
    });
  },

  close: (id) => set((s) => ({ windows: s.windows.filter((w) => w.id !== id) })),

  focus: (id) =>
    set((s) => {
      const target = s.windows.find((w) => w.id === id);
      if (!target || target.z === s.nextZ - 1) return s;
      return { windows: s.windows.map((w) => (w.id === id ? { ...w, z: s.nextZ } : w)), nextZ: s.nextZ + 1 };
    }),

  setRect: (id, rect) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, ...clampRect({ ...w, ...rect }, viewport()) } : w)),
    })),
}));
