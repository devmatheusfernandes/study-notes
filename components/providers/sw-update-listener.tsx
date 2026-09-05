"use client";

import { useEffect } from "react";
import { useSerwist } from "@serwist/turbopack/react";
import { useDeviceStore } from "@/hooks/ui/use-device";

/**
 * Feeds the update-scaffold already sitting in useDeviceStore
 * (registration/updateAvailable/update()) — see components/providers/update-toast.tsx
 * for what consumes it. Split into its own component (rather than folded into
 * DeviceListener) because it needs useSerwist(), which only works inside
 * SerwistProvider, while DeviceListener renders above it in app/layout.tsx.
 */
export function SwUpdateListener() {
  const { serwist } = useSerwist();
  const setRegistration = useDeviceStore((s) => s.setRegistration);
  const setUpdateAvailable = useDeviceStore((s) => s.setUpdateAvailable);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistration().then((reg) => setRegistration(reg ?? null));
  }, [setRegistration]);

  useEffect(() => {
    if (!serwist) return;
    // isUpdate is only true when a controller already existed before this SW
    // was found waiting — i.e. a real update, not the very first install.
    const onWaiting = (event: { isUpdate?: boolean }) => {
      if (event.isUpdate) setUpdateAvailable(true);
    };
    serwist.addEventListener("waiting", onWaiting);
    return () => serwist.removeEventListener("waiting", onWaiting);
  }, [serwist, setUpdateAvailable]);

  return null;
}
