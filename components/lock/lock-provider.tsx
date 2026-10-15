"use client";

import { useEffect } from "react";
import { AUTO_LOCK_HIDDEN_MS, AUTO_LOCK_IDLE_MS, useLockStore } from "@/lib/store/lock-store";
import { UnlockVault } from "./unlock-vault";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
const CHECK_INTERVAL_MS = 5000;

/**
 * Mounted once in the (app) layout: renders the unlock vault and puts the lock back
 * when the session has been idle, or the app has been in the background / screen off
 * for a short while — the moment a phone gets set down or handed over.
 */
export function LockProvider() {
  useEffect(() => {
    const { touch, lock } = useLockStore.getState();
    let hiddenAt: number | null = null;

    const onActivity = () => {
      if (useLockStore.getState().unlocked) touch();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= AUTO_LOCK_HIDDEN_MS) lock();
      hiddenAt = null;
    };
    document.addEventListener("visibilitychange", onVisibility);

    const interval = window.setInterval(() => {
      const s = useLockStore.getState();
      if (s.unlocked && Date.now() - s.lastActivity >= AUTO_LOCK_IDLE_MS) s.lock();
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, []);

  return <UnlockVault />;
}
