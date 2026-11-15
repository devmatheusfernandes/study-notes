"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useChatStore, type ChatSource } from "@/lib/store/chat-store";
import { addUserMessage as addUserMessageAction } from "@/app/(app)/chat-actions";
import { ChatMessage } from "./chat-message";
import { SmartComposer } from "@/components/ui/smart-composer";
import { useChatDockStore } from "@/lib/store/chat-dock-store";
import { cn } from "@/lib/utils";

interface ChatViewProps {
  conversationId: string;
  /** Rendered inside the docked side panel (components/chat/docked-chat.tsx) instead of as a page: fills its container, and never reads `?q=` from whatever page happens to be open. */
  docked?: boolean;
}

export function ChatView({ conversationId, docked = false }: ChatViewProps) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamStatus = useChatStore((s) => s.streamStatus);
  const addUserMsg = useChatStore((s) => s.addUserMessage);
  const startStream = useChatStore((s) => s.startAssistantStream);
  const appendDelta = useChatStore((s) => s.appendDelta);
  const finishStream = useChatStore((s) => s.finishStream);
  const failStream = useChatStore((s) => s.failStream);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // A `?q=` in the URL means the auto-send effect below is about to add the
  // user's message on its next tick — read synchronously (unlike the
  // effect-based window.location read in that effect, which only runs after
  // first paint) so the "pergunte algo" empty state below never has a chance
  // to flash in between this page mounting and that message actually landing.
  //
  // Captured ONCE, at mount. The auto-send effect below strips `?q=` from the
  // URL, and a live read would flip to "no question" a frame before the
  // message reaches the store — flashing the empty state in between.
  const searchParams = useSearchParams();
  const [pendingQuestion] = useState(() => (docked ? "" : (searchParams.get("q")?.trim() ?? "")));
  const hasPendingQuery = pendingQuestion !== "";
  // Opened with a question that hasn't reached the store yet: the composer
  // already reads as busy (as it did in the loading shell) instead of
  // flashing back to idle for a frame.
  const awaitingFirstSend = hasPendingQuery && messages.length === 0;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const streamResponse = useCallback(
    async (questionText: string, allowedSourceTypes: string[], webSearch: boolean) => {
      try {
        const response = await fetch(`/chats/${conversationId}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: questionText, allowedSourceTypes, webSearch }),
        });

        if (!response.ok || !response.body) {
          failStream("Erro ao conectar ao assistente.");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sources: ChatSource[] = [];
        let sourcesUncertain = false;

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
              } else if (event.type === "status" && event.text) {
                useChatStore.getState().setStreamStatus(event.text);
              } else if (event.type === "title" && event.title) {
                useChatStore.getState().updateConversation(conversationId, { title: event.title });
              } else if (event.type === "sources") {
                sources = event.sources ?? [];
                sourcesUncertain = !!event.uncertain;
              } else if (event.type === "done") {
                finishStream(sources, sourcesUncertain);
              } else if (event.type === "error") {
                failStream(event.content || "Erro desconhecido.");
              }
            } catch {
              // skip malformed JSON
            }
          }
        }

        if (useChatStore.getState().isStreaming) {
          finishStream(sources, sourcesUncertain);
        }
      } catch {
        failStream("Falha na conexão com o assistente.");
      }
    },
    [conversationId, appendDelta, finishStream, failStream]
  );

  const sendMessage = useCallback(
    async (content: string, allowedSourceTypes: string[] = ["nota", "pdf", "jwpub", "video", "estudo_pessoal", "biblia"], webSearch = false) => {
      // 1. Optimistic user message, and the assistant's "thinking" placeholder
      // right behind it — not after the persist below, which is a server round
      // trip during which the person would otherwise see their message and
      // nothing answering it.
      addUserMsg(content);
      startStream();

      // 2. Persist user message server-side
      const result = await addUserMessageAction(conversationId, content);
      if (result.error) {
        failStream(result.error);
        return;
      }

      // 3. Start streaming assistant response
      await streamResponse(content, allowedSourceTypes, webSearch);
    },
    [conversationId, addUserMsg, startStream, failStream, streamResponse]
  );

  // Auto-send initial question if navigated with ?q= (e.g. from ChatsDock or start page)
  const initialQueryFired = useRef(false);

  useEffect(() => {
    // The dock lives across every page, so `?q=` there belongs to some other screen.
    if (docked || initialQueryFired.current) return;
    const searchParams = new URLSearchParams(window.location.search);
    const initialQuery = searchParams.get("q")?.trim();
    if (!initialQuery) return;

    initialQueryFired.current = true;
    const sourcesParam = searchParams.get("sources");
    const allowedSourceTypes = sourcesParam
      ? sourcesParam.split(",")
      : ["nota", "pdf", "jwpub", "video", "estudo_pessoal", "biblia"];

    // Clean URL without triggering page reload
    window.history.replaceState(null, "", window.location.pathname);

    void sendMessage(initialQuery, allowedSourceTypes);
  }, [sendMessage, docked]);

  // The chat store holds ONE conversation's messages, so a chat opened as a
  // page takes over from the docked one (opening the docked chat full-screen
  // is exactly this).
  useEffect(() => {
    if (!docked) useChatDockStore.getState().close();
  }, [docked]);

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden",
        docked ? "h-full" : "h-[calc(100vh-3.5rem)]"
      )}
    >
      {/* Scrollable conversation messages container */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 pt-6 pb-32 sm:px-6">
        <div className="mx-auto flex w-full min-w-0 max-w-2xl sm:max-w-3xl flex-col gap-4">
          {messages.length === 0 && hasPendingQuery && (
            // The question this chat was opened with, until the auto-send
            // below puts the real messages in the store. Same markup as
            // chat-loading.tsx's shell, so nothing changes on screen.
            <>
              <ChatMessage role="user" content={pendingQuestion} sources={[]} instant />
              <ChatMessage role="assistant" content="" sources={[]} isStreaming instant />
            </>
          )}
          {messages.length === 0 && !hasPendingQuery && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent/15">
                <span className="text-lg">✨</span>
              </span>
              <p className="text-sm text-muted-foreground">
                Pergunte algo sobre suas notas e documentos vetorizados.
              </p>
            </div>
          )}
          {messages.map((msg, index) => (
            <ChatMessage
              key={msg.id}
              instant={hasPendingQuery && index < 2}
              role={msg.role}
              content={msg.content}
              sources={msg.sources}
              sourcesUncertain={msg.sourcesUncertain}
              isStreaming={msg.isStreaming}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Floating ChatGPT-style capsule input bar */}
      <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-20 px-4 sm:px-6">
        <div className="pointer-events-auto mx-auto max-w-2xl sm:max-w-3xl">
          <SmartComposer
            variant="chat"
            onSend={sendMessage}
            disabled={isStreaming || awaitingFirstSend}
            statusText={
              isStreaming ? (streamStatus ?? "Escrevendo resposta…") : awaitingFirstSend ? "Enviando…" : undefined
            }
            placeholder="Pergunte às suas notas ou vídeos…"
          />
        </div>
      </div>
    </div>
  );
}
