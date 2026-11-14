"use client";

import { useEffect } from "react";
import { useDeviceStore, type BeforeInstallPromptEvent } from "@/hooks/ui/use-device";
import { useNotesStore, usePendingSyncCount } from "@/lib/store/notes-store";
import { useJwOutbox } from "@/lib/offline/jwlibrary-outbox";
import { OFFLINE_INVENTORY_CHANGED_EVENT } from "@/lib/offline/inventory-events";
import { publishInventory } from "@/lib/offline/device-inventory";

const MOBILE_QUERY = "(max-width: 767px)";
const STANDALONE_QUERY = "(display-mode: standalone)";

export function DeviceListener() {
  const setIsMobile = useDeviceStore((s) => s.setIsMobile);
  const setStandalone = useDeviceStore((s) => s.setStandalone);
  const setIsOnline = useDeviceStore((s) => s.setIsOnline);
  const setDeferredPrompt = useDeviceStore((s) => s.setDeferredPrompt);
  const pendingSyncCount = usePendingSyncCount();

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

  // Tells the server what this device has downloaded (so Settings can list it per
  // device): shortly after the app opens, whenever a download is added or removed,
  // and when the connection comes back.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (navigator.onLine) void publishInventory().catch(() => {});
      }, delay);
    };
    schedule(4000);
    const onChange = () => schedule(1500);
    window.addEventListener(OFFLINE_INVENTORY_CHANGED_EVENT, onChange);
    window.addEventListener("online", onChange);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(OFFLINE_INVENTORY_CHANGED_EVENT, onChange);
      window.removeEventListener("online", onChange);
    };
  }, []);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      void useNotesStore.getState().syncPendingOps();
      void useJwOutbox.getState().sync();
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
    if (navigator.onLine) void useJwOutbox.getState().sync();

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
      if (navigator.onLine && useJwOutbox.getState().ops.length > 0) void useJwOutbox.getState().sync();
    }, 5000);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("focus", recheckOnFocus);
      document.removeEventListener("visibilitychange", recheckOnFocus);
      clearInterval(poll);
    };
  }, [setIsOnline]);

  // Centralizes install-prompt capture so both the sidebar nudge and
  // /install's card can trigger the native prompt via useDeviceStore
  // instead of each keeping its own listener.
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferredPrompt(null);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [setDeferredPrompt]);

  // Badges the installed app icon with the offline-outbox size — a real,
  // already-computed signal (also shown in sidebar-content.tsx's status
  // card), not a fabricated use case for a feature that normally needs push.
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    try {
      if (pendingSyncCount > 0) void navigator.setAppBadge(pendingSyncCount);
      else void navigator.clearAppBadge();
    } catch {
      // ignore — badging can throw in some embedded/unsupported contexts
    }
  }, [pendingSyncCount]);

  return null;
}
