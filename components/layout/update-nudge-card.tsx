"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDevice, useDeviceStore } from "@/hooks/ui/use-device";

/**
 * Sidebar counterpart to UpdateToast (components/providers/update-toast.tsx):
 * the toast is dismissible (and easy to swipe away by accident), and once
 * gone there was no other way to trigger the update short of a manual
 * reload. This stays visible in the sidebar for as long as
 * useDeviceStore's updateAvailable flag is true, independent of whether the
 * toast was dismissed — same "persistent nudge, not a one-shot prompt"
 * pattern as InstallNudgeCard right below it.
 */
export function UpdateNudgeCard() {
  const { updateAvailable } = useDevice();
  const [updating, setUpdating] = useState(false);

  if (!updateAvailable) return null;

  return (
    <div className="flex flex-col gap-2 rounded-3xl bg-secondary p-3.5">
      <span className="font-mono text-[10px] font-medium tracking-[0.08em] text-accent">
        ATUALIZAÇÃO DISPONÍVEL
      </span>
      <span className="text-[12px] leading-relaxed text-muted-foreground">
        Uma nova versão do Study Notes está pronta para uso.
      </span>
      <Button
        size="xs"
        className="self-start"
        disabled={updating}
        leftIcon={<RefreshCw className={updating ? "animate-spin" : undefined} />}
        onClick={() => {
          setUpdating(true);
          useDeviceStore.getState().update();
        }}
      >
        {updating ? "Atualizando…" : "Atualizar"}
      </Button>
    </div>
  );
}
