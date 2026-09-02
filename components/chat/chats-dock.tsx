"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SmartComposer } from "@/components/ui/smart-composer";
import { useChatStore } from "@/lib/store/chat-store";
import { createConversation } from "@/app/(app)/chat-actions";
import { notify } from "@/components/ui/toaster";

export function ChatsDock() {
  const router = useRouter();
  const addConv = useChatStore((s) => s.addConversation);
  const [isCreating, setIsCreating] = useState(false);

  async function handleStartNewChat(message: string, allowedSourceTypes: string[]) {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const result = await createConversation(message);
      if (result.error || !result.conversationId) {
        notify.error("Não foi possível criar a conversa.");
        return;
      }
      addConv({
        id: result.conversationId,
        title: message.trim().slice(0, 60) || "Nova conversa",
        status: "active",
        updatedAt: Date.now(),
      });
      const query = new URLSearchParams();
      query.set("q", message);
      if (allowedSourceTypes.length < 4) {
        query.set("sources", allowedSourceTypes.join(","));
      }
      router.push(`/chats/${result.conversationId}?${query.toString()}`);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <SmartComposer
      variant="chat"
      onSend={handleStartNewChat}
      disabled={isCreating}
      placeholder={isCreating ? "Iniciando conversa…" : "Pergunte às suas notas ou vídeos…"}
    />
  );
}
