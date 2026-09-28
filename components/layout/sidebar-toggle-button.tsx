"use client";

import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebarStore } from "@/lib/store/sidebar-store";

/**
 * Opens the sidebar drawer — mobile only. On desktop the sidebar is always on
 * screen (`md:flex`) and carries its own collapse button in its header, so
 * this one had nothing left to do there.
 *
 * Hidden with `md:hidden` rather than by reading `useDevice().isMobile`:
 * that store starts out `false` and is only corrected once DeviceListener
 * runs, which would flash the button in and out on a phone. The breakpoint
 * matches the store exactly anyway — `isMobile` is `(max-width: 767px)`.
 */
export function SidebarToggleButton() {
  const openMobile = useSidebarStore((s) => s.openMobile);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Abrir menu"
      onClick={openMobile}
      className="md:hidden"
    >
      <PanelLeft className="size-[18px]" />
    </Button>
  );
}
