"use client";

import { useCallback, useEffect, useRef } from "react";
import { useChatStore, type ChatSource } from "@/lib/store/chat-store";
import { addUserMessage as addUserMessageAction } from "@/app/(app)/chat-actions";
import { ChatMessage } from "./chat-message";
import { ChatComposer } from "./chat-composer";

interface ChatViewProps {
  conversationId: string;
}

export function ChatView({ conversationId }: ChatViewProps) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const addUserMsg = useChatStore((s) => s.addUserMessage);
  const startStream = useChatStore((s) => s.startAssistantStream);
  const appendDelta = useChatStore((s) => s.appendDelta);
  const finishStream = useChatStore((s) => s.finishStream);
  const failStream = useChatStore((s) => s.failStream);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (content: string) => {
      // 1. Optimistic user message
      addUserMsg(content);

      // 2. Persist user message server-side
      const result = await addUserMessageAction(conversationId, content);
      if (result.error) {
        failStream(result.error);
        return;
      }

      // 3. Start streaming assistant response
      startStream();

      try {
        const response = await fetch(`/chats/${conversationId}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: content }),
        });

        if (!response.ok || !response.body) {
          failStream("Erro ao conectar ao assistente.");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sources: ChatSource[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr);

              if (event.type === "delta" && event.content) {
                appendDelta(event.content);
              } else if (event.type === "title" && event.title) {
                useChatStore.getState().updateConversation(conversationId, { title: event.title });
              } else if (event.type === "sources") {
                sources = event.sources ?? [];
              } else if (event.type === "done") {
                finishStream(sources);
              } else if (event.type === "error") {
                failStream(event.content || "Erro desconhecido.");
              }
            } catch {
              // skip malformed JSON
            }
          }
        }

        // If stream ended without a "done" event
        if (useChatStore.getState().isStreaming) {
          finishStream(sources);
        }
      } catch {
        failStream("Falha na conexão com o assistente.");
      }
    },
    [conversationId, addUserMsg, startStream, appendDelta, finishStream, failStream]
  );

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent/15">
                <span className="text-lg">✨</span>
              </span>
              <p className="text-sm text-muted-foreground">
                Pergunte algo sobre suas notas e documentos vetorizados.
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              role={msg.role}
              content={msg.content}
              sources={msg.sources}
              isStreaming={msg.isStreaming}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <ChatComposer
            onSend={sendMessage}
            disabled={isStreaming}
            placeholder={isStreaming ? "Gerando resposta…" : "Pergunte às suas notas…"}
          />
        </div>
      </div>
    </div>
  );
}
