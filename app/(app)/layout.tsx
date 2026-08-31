import { Sidebar } from "@/components/layout/sidebar";
import { AssistantSurface } from "@/components/assistant/assistant-surface";
import { StoreHydration } from "@/components/providers/store-hydration";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full">
      <StoreHydration />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <AssistantSurface />
    </div>
  );
}
