"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, X } from "lucide-react";
import { useChatDockStore } from "@/lib/store/chat-dock-store";
import { useChatStore } from "@/lib/store/chat-store";
import { ChatView } from "./chat-view";

const DOCK_WIDTH = 420;

/**
 * The chat pinned to the right edge, so it stays put while the person opens
 * notes, publications or the Bible beside it and compares answers with what
 * they're reading.
 *
 * It's a flex sibling of the page column in the (app) layout — after it — so
 * the reader's own reference panels (which live INSIDE the page column) open
 * to its left, next to the chat, and everything shrinks instead of overlapping.
 *
 * Desktop only (`lg`): on a phone there's no room for a second column, and on
 * a tablet sidebar + page + dock leaves the page unreadable.
 */
export function DockedChat() {
  const router = useRouter();
  const conversationId = useChatDockStore((s) => s.conversationId);
  const close = useChatDockStore((s) => s.close);
  const title = useChatStore((s) => s.conversations.find((c) => c.id === conversationId)?.title);

  return (
    <AnimatePresence initial={false}>
      {conversationId && (
        <motion.aside
          key="docked-chat"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: DOCK_WIDTH, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="sticky top-0 hidden h-dvh shrink-0 overflow-hidden border-l border-border bg-sidebar lg:block"
        >
          <div className="flex h-full flex-col" style={{ width: DOCK_WIDTH }}>
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
              <h2 className="mr-auto min-w-0 truncate font-heading text-base">{title ?? "Chat"}</h2>
              <button
                type="button"
                onClick={() => router.push(`/chats/${conversationId}`)}
                aria-label="Abrir em tela cheia"
                title="Abrir em tela cheia"
                className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Maximize2 className="size-4" />
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Fechar chat"
                title="Fechar chat"
                className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1">
              <ChatView key={conversationId} conversationId={conversationId} docked />
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
