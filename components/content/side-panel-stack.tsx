"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

interface SidePanelEntry {
  id: string;
  title: string;
}

interface SidePanelStackValue {
  /** Every open panel, in the order it opened — only the last one is visible on desktop. */
  entries: SidePanelEntry[];
  /** Registers a panel as open, or updates its title in place (never reorders). */
  open: (id: string, title: string) => void;
  close: (id: string) => void;
  setCloser: (id: string, onClose: () => void) => void;
  closeAll: () => void;
}

const SidePanelStackContext = createContext<SidePanelStackValue | null>(null);

/**
 * Makes every `JwpubSidePanel` under it share ONE desktop sidebar slot instead
 * of opening a column of its own beside the previous one.
 *
 * Opening a reference from inside the study panel used to put two full panels
 * side by side, eating most of the reading width on a laptop. Now the panels
 * form a stack: the newest one takes the slot, the ones underneath collapse to
 * zero width (they stay mounted, so their scroll position and loaded content
 * survive), and the visible one grows a "voltar" button that pops back to
 * whatever it covered.
 *
 * Mobile is untouched — there each panel is its own `Vault` sheet, which
 * already stacks and dismisses one at a time.
 */
export function SidePanelStackProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<SidePanelEntry[]>([]);

  // `closeAll` has to stay referentially stable (it ends up in a header button
  // that every panel renders), so it reads the stack through a ref instead of
  // closing over the current `entries`.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const closers = useRef(new Map<string, () => void>());

  const open = useCallback((id: string, title: string) => {
    setEntries((prev) => {
      const index = prev.findIndex((entry) => entry.id === id);
      // Already stacked → only ever update the title in place. Re-appending
      // would promote a panel to the top of the stack just because its title
      // resolved late (JwpubReferenceSurface goes "Referência" → the real
      // publication name once the chapter loads).
      if (index === -1) return [...prev, { id, title }];
      if (prev[index].title === title) return prev;
      const next = [...prev];
      next[index] = { id, title };
      return next;
    });
  }, []);

  const close = useCallback((id: string) => {
    closers.current.delete(id);
    setEntries((prev) => (prev.some((entry) => entry.id === id) ? prev.filter((entry) => entry.id !== id) : prev));
  }, []);

  const setCloser = useCallback((id: string, onClose: () => void) => {
    closers.current.set(id, onClose);
  }, []);

  const closeAll = useCallback(() => {
    // Snapshot first: each `onClose` is a consumer's setState, which will come
    // back around and mutate this same list.
    for (const entry of [...entriesRef.current]) closers.current.get(entry.id)?.();
  }, []);

  const value = useMemo(
    () => ({ entries, open, close, setCloser, closeAll }),
    [entries, open, close, setCloser, closeAll]
  );

  return <SidePanelStackContext.Provider value={value}>{children}</SidePanelStackContext.Provider>;
}

interface SidePanelSlotOptions {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  /** False on mobile, where panels are Vault sheets and don't share a slot. */
  enabled: boolean;
}

/**
 * Claims this panel's place in the shared stack. With no provider above it
 * (e.g. the offline shell), it degrades to exactly the old behaviour: always
 * visible, no back button.
 */
export function useSidePanelSlot({ id, title, open, onClose, enabled }: SidePanelSlotOptions) {
  const stack = useContext(SidePanelStackContext);
  const register = stack?.open;
  const unregister = stack?.close;
  const setCloser = stack?.setCloser;

  // Consumers pass inline arrows for `onClose`, so it can't be a registration
  // dependency — it would churn the stack on every render. Kept fresh here
  // instead, for `closeAll` to call later.
  useEffect(() => {
    if (!enabled || !open || !setCloser) return;
    setCloser(id, onClose);
  });

  useEffect(() => {
    if (!enabled || !open || !register) return;
    register(id, title);
  }, [enabled, open, title, id, register]);

  // Deliberately separate from the effect above: this one must NOT re-run when
  // the title changes, or the panel would leave and re-enter the stack.
  useEffect(() => {
    if (!enabled || !open || !unregister) return;
    return () => unregister(id);
  }, [enabled, open, id, unregister]);

  const entries = stack?.entries;
  const index = entries?.findIndex((entry) => entry.id === id) ?? -1;

  return {
    /** Unstacked panels (no provider, or not registered yet) render as they always did. */
    isTop: index === -1 || index === (entries?.length ?? 0) - 1,
    /** Title of the panel this one is covering, for the back button's label. */
    previousTitle: index > 0 ? (entries?.[index - 1].title ?? null) : null,
    closeAll: stack?.closeAll ?? onClose,
  };
}
