import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { Sidebar } from "@/components/layout/sidebar";
import { SidebarToggleButton } from "@/components/layout/sidebar-toggle-button";
import { OfflineStoreHydration } from "@/components/providers/offline-store-hydration";

export const metadata: Metadata = {
  title: "Você está offline — Study Notes",
};

export default function OfflinePage() {
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <OfflineStoreHydration />
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:gap-3 sm:px-6">
          <SidebarToggleButton />
        </header>
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-hidden bg-background px-4 text-center">
          <FadeIn className="flex flex-col items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <WifiOff className="size-6" />
            </div>
            <h1 className="font-heading text-2xl">Você está offline</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              Essa página ainda não tinha sido salva no seu dispositivo. Use o menu para
              voltar a uma área que você já visitou — ela deve abrir normalmente offline.
            </p>
          </FadeIn>
        </main>
      </div>
    </div>
  );
}
