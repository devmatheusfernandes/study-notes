"use client";

import { useEffect, useRef } from "react";
import { useChatStore, type ChatConversation } from "@/lib/store/chat-store";

interface ChatHydrationProps {
  conversations: ChatConversation[];
}

export function ChatHydration({ conversations }: ChatHydrationProps) {
  const hasHydrated = useRef(false);
  const setConversations = useChatStore((s) => s.setConversations);

  useEffect(() => {
    if (hasHydrated.current) return;
    hasHydrated.current = true;
    setConversations(conversations);
  }, [conversations, setConversations]);

  return null;
}
