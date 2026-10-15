import { create } from "zustand";

/**
 * Whether locked notes/folders are currently readable. Deliberately NOT persisted —
 * a reload, a new tab, or the idle/visibility relock in <LockProvider> all put the
 * lock back, so there is never a stored "unlocked" flag for someone to inherit.
 */
interface LockStore {
  unlocked: boolean;
  lastActivity: number;
  promptOpen: boolean;
  /** Callers of `requestUnlock` waiting on the prompt's outcome. */
  waiters: Array<(ok: boolean) => void>;
  /** Resolves true immediately when already unlocked, otherwise opens the unlock vault and resolves with its outcome. */
  requestUnlock: () => Promise<boolean>;
  /** Called by the unlock vault once the biometric or PIN check passes. */
  completeUnlock: () => void;
  /** Called by the unlock vault when dismissed without unlocking. */
  cancelPrompt: () => void;
  lock: () => void;
  touch: () => void;
}

export const useLockStore = create<LockStore>()((set, get) => ({
  unlocked: false,
  lastActivity: Date.now(),
  promptOpen: false,
  waiters: [],

  requestUnlock: () => {
    if (get().unlocked) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      set((s) => ({ promptOpen: true, waiters: [...s.waiters, resolve] }));
    });
  },

  completeUnlock: () => {
    const { waiters } = get();
    set({ unlocked: true, lastActivity: Date.now(), promptOpen: false, waiters: [] });
    waiters.forEach((resolve) => resolve(true));
  },

  cancelPrompt: () => {
    const { waiters } = get();
    set({ promptOpen: false, waiters: [] });
    waiters.forEach((resolve) => resolve(false));
  },

  lock: () => set({ unlocked: false }),

  touch: () => set({ lastActivity: Date.now() }),
}));

/** Idle time after which an unlocked session locks itself again. */
export const AUTO_LOCK_IDLE_MS = 2 * 60 * 1000;
/** How long the app may sit in the background before it locks. */
export const AUTO_LOCK_HIDDEN_MS = 20 * 1000;
