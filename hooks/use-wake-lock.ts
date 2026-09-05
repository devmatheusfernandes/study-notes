import { useEffect } from "react";

/**
 * Keeps the screen awake while `enabled` — for long, hands-off reading
 * surfaces (jwpub/bible/pdf readers). Silently degrades wherever the Wake
 * Lock API isn't available (older Safari). A lock auto-releases when the tab
 * is backgrounded, so it's re-acquired on refocus.
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        lock = sentinel;
      } catch {
        // ignore — e.g. denied, or the tab isn't visible yet
      }
    }

    void acquire();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !lock) void acquire();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void lock?.release();
    };
  }, [enabled]);
}
