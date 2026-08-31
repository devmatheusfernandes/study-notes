"use client";

import { useEffect } from "react";
import { useDeviceStore } from "@/hooks/ui/use-device";

const MOBILE_QUERY = "(max-width: 767px)";
const STANDALONE_QUERY = "(display-mode: standalone)";

export function DeviceListener() {
  const setIsMobile = useDeviceStore((s) => s.setIsMobile);
  const setStandalone = useDeviceStore((s) => s.setStandalone);

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

  return null;
}
