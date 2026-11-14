"use client";

import { useRouter } from "next/navigation";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatDockStore } from "@/lib/store/chat-dock-store";

/**
 * Moves this chat into the side dock and returns to the chats list, so other
 * pages can be opened with the conversation still beside them. Desktop only —
 * the dock itself is hidden below `lg`.
 */
export function DockChatButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const dock = useChatDockStore((s) => s.dock);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Fixar chat na lateral"
      title="Fixar chat na lateral"
      className="hidden lg:inline-flex"
      onClick={() => {
        dock(conversationId);
        router.push("/chats");
      }}
    >
      <PanelRight className="size-[18px]" />
    </Button>
  );
}
