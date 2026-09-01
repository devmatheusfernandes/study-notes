"use client";

import { useEffect, useRef } from "react";
import { useChatStore, type ChatMessage } from "@/lib/store/chat-store";

interface ChatMessagesHydrationProps {
  conversationId: string;
  messages: ChatMessage[];
}

export function ChatMessagesHydration({ conversationId, messages }: ChatMessagesHydrationProps) {
  const hasHydrated = useRef<string | null>(null);
  const setMessages = useChatStore((s) => s.setMessages);
  const setActiveConversationId = useChatStore((s) => s.setActiveConversationId);

  useEffect(() => {
    if (hasHydrated.current === conversationId) return;
    hasHydrated.current = conversationId;
    setActiveConversationId(conversationId);
    setMessages(messages);
  }, [conversationId, messages, setMessages, setActiveConversationId]);

  return null;
}
