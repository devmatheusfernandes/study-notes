import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { AssistantSurface } from "@/components/assistant/assistant-surface";
import { SidePanelStackProvider } from "@/components/content/side-panel-stack";
import { FloatingWindowsHost } from "@/components/content/floating-windows-host";
import { StoreHydration } from "@/components/providers/store-hydration";
import { DockedChat } from "@/components/chat/docked-chat";
import { ChatHydration } from "@/components/chat/chat-hydration";
import { LockProvider } from "@/components/lock/lock-provider";

// Deliberately synchronous and fetch-free: notes, folders, chats and
// preferences load client-side (StoreHydration / ChatHydration). Awaiting them
// here made the whole (app) subtree dynamic, so it couldn't be shown offline.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // SidePanelStackProvider renders no DOM of its own — it only lets every
    // JwpubSidePanel under it share one desktop sidebar slot (stacking with a
    // back button) instead of opening side by side.
    <SidePanelStackProvider>
      <div className="flex min-h-dvh w-full">
        <StoreHydration />
        <ChatHydration />
        <LockProvider />
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col"><Suspense>{children}</Suspense></div>
        <DockedChat />
        <AssistantSurface />
        <FloatingWindowsHost />
      </div>
    </SidePanelStackProvider>
  );
}
