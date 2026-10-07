"use client";

import { Drawer } from "vaul";
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
            className="fixed inset-y-0 left-0 z-50 flex h-full w-[260px] max-w-[82vw] flex-col overflow-y-auto bg-[#161413] p-5 pt-[max(1.25rem,env(safe-area-inset-top))] outline-none"
          >
            <Drawer.Title className="sr-only">Menu</Drawer.Title>
            <SidebarContent onNavigate={closeMobile} />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  const width = desktopCollapsed ? "w-[76px]" : "w-[232px]";

  return (
    <>
      {/* The sidebar is `fixed` to the viewport, not `sticky`: sticky depends on
          every ancestor's overflow and on the page's own scroll, and on the
          Bible screen it scrolled away with the content. This spacer holds the
          sidebar's column in the flex row so the content keeps its offset. */}
      <div aria-hidden className={cn("hidden shrink-0 transition-[width] duration-200 md:block", width)} />
      <aside
        // No visible collapse/expand button anymore — the sidebar itself is
        // the toggle target instead. `e.target === e.currentTarget` only fires
        // for clicks that land on the aside's own empty space (the gaps
        // between nav items, the header padding, the bottom spacer), not on
        // any nav link/button inside SidebarContent, so this never hijacks a
        // normal navigation click.
        onClick={(e) => {
          if (e.target === e.currentTarget) toggleDesktop();
        }}
        aria-label={desktopCollapsed ? "Expandir menu" : "Recolher menu"}
        title={desktopCollapsed ? "Expandir menu" : "Recolher menu"}
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden cursor-pointer flex-col overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-r border-border bg-[#161413] pb-5 pt-5 transition-[width] duration-200 md:flex",
          width,
          desktopCollapsed ? "px-3" : "px-4"
        )}
      >
        <SidebarContent collapsed={desktopCollapsed} onToggleCollapse={toggleDesktop} />
      </aside>
    </>
  );
}
