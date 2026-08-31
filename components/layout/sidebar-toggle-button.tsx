"use client";

import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/hooks/ui/use-device";
import { useSidebarStore } from "@/lib/store/sidebar-store";

export function SidebarToggleButton() {
  const { isMobile } = useDevice();
  const openMobile = useSidebarStore((s) => s.openMobile);
  const toggleDesktop = useSidebarStore((s) => s.toggleDesktop);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Abrir menu"
      onClick={() => (isMobile ? openMobile() : toggleDesktop())}
    >
      <PanelLeft className="size-[18px]" />
    </Button>
  );
}
