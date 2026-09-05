"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDevice, useDeviceStore } from "@/hooks/ui/use-device";

const DISMISS_KEY = "install-nudge-dismissed-count";
const MAX_DISMISSALS = 3;

function readDismissCount() {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? "0");
  } catch {
    return 0;
  }
}

/**
 * Sidebar counterpart to /install — a low-friction nudge rather than a full
 * page, so users who'd install but never think to look for /install get a
 * chance to. Not a Vault/modal: dismissing isn't destructive, so it doesn't
 * need the app's one confirmation surface (see components/ui/confirm-vault.tsx).
 */
export function InstallNudgeCard() {
  const { isStandalone, isInstallable } = useDevice();
  const [dismissCount, setDismissCount] = useState<number | null>(null);

  useEffect(() => {
    setDismissCount(readDismissCount());
  }, []);

  if (isStandalone || dismissCount === null || dismissCount >= MAX_DISMISSALS) return null;

  function dismiss() {
    const next = readDismissCount() + 1;
    try {
      localStorage.setItem(DISMISS_KEY, String(next));
    } catch {
      // ignore
    }
    setDismissCount(next);
  }

  return (
    <div className="flex flex-col gap-2 rounded-3xl bg-secondary p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] font-medium tracking-[0.08em] text-accent">
          INSTALAR APP
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dispensar"
          className="-m-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <span className="text-[12px] leading-relaxed text-muted-foreground">
        Use o Study Notes na tela inicial, com acesso mais rápido e offline.
      </span>
      {isInstallable ? (
        <Button size="xs" className="self-start" onClick={() => void useDeviceStore.getState().install()}>
          Instalar
        </Button>
      ) : (
        <Button size="xs" className="self-start" render={<Link href="/install" />}>
          Ver como instalar
        </Button>
      )}
    </div>
  );
}
