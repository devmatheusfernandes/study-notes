"use client";

import { useEffect, useRef } from "react";
import { useChatStore, type ChatConversation } from "@/lib/store/chat-store";
import { listConversations } from "@/app/(app)/chat-actions";

interface ChatHydrationProps {
  /** Omit to fetch client-side (what the static (app) layout does). */
  conversations?: ChatConversation[];
}

export function ChatHydration({ conversations }: ChatHydrationProps) {
  const hasHydrated = useRef(false);
  const setConversations = useChatStore((s) => s.setConversations);

  useEffect(() => {
    if (hasHydrated.current) return;
    hasHydrated.current = true;
    if (conversations) {
      setConversations(conversations);
      return;
    }
    void listConversations()
      .then((rows) =>
        setConversations(rows.map((r) => ({ id: r.id, title: r.title, status: r.status, updatedAt: r.updatedAt })))
      )
      .catch(() => {
        // offline — keep whatever the store already has
      });
  }, [conversations, setConversations]);

  return null;
}
