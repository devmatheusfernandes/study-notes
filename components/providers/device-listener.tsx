"use client";

import { useEffect } from "react";
import { useDeviceStore } from "@/hooks/ui/use-device";
import { useNotesStore } from "@/lib/store/notes-store";

const MOBILE_QUERY = "(max-width: 767px)";
const STANDALONE_QUERY = "(display-mode: standalone)";

export function DeviceListener() {
  const setIsMobile = useDeviceStore((s) => s.setIsMobile);
  const setStandalone = useDeviceStore((s) => s.setStandalone);
  const setIsOnline = useDeviceStore((s) => s.setIsOnline);

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_QUERY);
    const standaloneQuery = window.matchMedia(STANDALONE_QUERY);

    const syncMobile = () => setIsMobile(mobileQuery.matches);
    const syncStandalone = () => setStandalone(standaloneQuery.matches);

    syncMobile();
    syncStandalone();

    mobileQuery.addEventListener("change", syncMobile);
    standaloneQuery.addEventListener("change", syncStandalone);
    return () => {
      mobileQuery.removeEventListener("change", syncMobile);
      standaloneQuery.removeEventListener("change", syncStandalone);
    };
  }, [setIsMobile, setStandalone]);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      void useNotesStore.getState().syncPendingOps();
    };
    const goOffline = () => setIsOnline(false);
    // Fallback for the (rare, but real — e.g. some mobile browsers, and some
    // test/automation network emulation) cases where the 'online' event
    // doesn't fire reliably: re-check whenever the tab regains focus.
    const recheckOnFocus = () => {
      if (navigator.onLine) goOnline();
    };

    setIsOnline(navigator.onLine);
    // Catches drafts left queued from a previous session (tab closed while offline).
    if (navigator.onLine) void useNotesStore.getState().syncPendingOps();

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("focus", recheckOnFocus);
    document.addEventListener("visibilitychange", recheckOnFocus);

    // Belt-and-suspenders: if both the 'online' event and the focus/visibility
    // fallback above get missed (it happens), this guarantees a queued draft
    // still syncs within a few seconds of connectivity actually returning,
    // instead of sitting there until the next manual interaction.
    const poll = setInterval(() => {
      if (navigator.onLine && Object.keys(useNotesStore.getState().pendingOps).length > 0) {
        void useNotesStore.getState().syncPendingOps();
      }
    }, 5000);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("focus", recheckOnFocus);
      document.removeEventListener("visibilitychange", recheckOnFocus);
      clearInterval(poll);
    };
  }, [setIsOnline]);

  return null;
}
