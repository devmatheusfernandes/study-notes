"use client";

import { useEffect, useRef } from "react";
import { notify } from "@/components/ui/toaster";
import { useDeviceStore } from "@/hooks/ui/use-device";

/**
 * Surfaces useDeviceStore's updateAvailable flag (set by SwUpdateListener)
 * as a dismissible action toast. Uses notify.sonner (the raw sonner escape
 * hatch) rather than notify.* — those route to a Vault sheet in standalone
 * mode and don't support an action button either way.
 */
export function UpdateToast() {
  const updateAvailable = useDeviceStore((s) => s.updateAvailable);
  const shown = useRef(false);

  useEffect(() => {
    if (!updateAvailable || shown.current) return;
    shown.current = true;
    notify.sonner("Nova versão disponível", {
      description: "Atualize para aplicar as últimas melhorias.",
      duration: Infinity,
      action: {
        label: "Atualizar",
        onClick: () => useDeviceStore.getState().update(),
      },
    });
  }, [updateAvailable]);

  return null;
}
