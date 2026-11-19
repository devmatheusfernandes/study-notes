import { useEffect, useState } from "react";
import { getBibleOfflineInfo } from "@/lib/offline/bible-offline";

/** Shared by every caller, so a panel with a dozen excerpts asks IndexedDB once. */
let known: boolean | undefined;

/**
 * Whether the whole Bible is on this device (Settings → Bíblia offline). Starts
 * `false` and settles after one IndexedDB read, so anything gated on it simply
 * isn't offered until it's known to work.
 */
export function useBibleDownloaded(): boolean {
  const [downloaded, setDownloaded] = useState(known ?? false);

  useEffect(() => {
    let cancelled = false;
    void getBibleOfflineInfo().then((info) => {
      known = info !== null;
      if (!cancelled) setDownloaded(known);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return downloaded;
}
