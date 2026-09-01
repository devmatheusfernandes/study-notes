"use client";

import { Drawer } from "vaul";
import { PanelLeftClose, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDevice } from "@/hooks/ui/use-device";
import { useSidebarStore } from "@/lib/store/sidebar-store";
import { SidebarContent } from "./sidebar-content";

export function Sidebar() {
  const { isMobile } = useDevice();
  const { mobileOpen, closeMobile, desktopCollapsed, toggleDesktop } = useSidebarStore();

  if (isMobile) {
    return (
      <Drawer.Root direction="left" open={mobileOpen} onOpenChange={(open) => !open && closeMobile()}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
          <Drawer.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex h-full w-[260px] max-w-[82vw] flex-col bg-[#161413] p-5 pt-[max(1.25rem,env(safe-area-inset-top))] outline-none"
          >
            <Drawer.Title className="sr-only">Menu</Drawer.Title>
            <SidebarContent onNavigate={closeMobile} />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-[#161413] pb-5 transition-[width] duration-200 md:flex",
        desktopCollapsed ? "w-[76px] px-3" : "w-[232px] px-4"
      )}
    >
      <SidebarContent collapsed={desktopCollapsed} />
      <button
        type="button"
        onClick={toggleDesktop}
        aria-label={desktopCollapsed ? "Expandir menu" : "Recolher menu"}
        className={cn(
          "mt-4 flex items-center gap-2 rounded-full px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
          desktopCollapsed && "justify-center px-0"
        )}
      >
        {desktopCollapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
        {!desktopCollapsed && "Recolher"}
      </button>
    </aside>
  );
}
