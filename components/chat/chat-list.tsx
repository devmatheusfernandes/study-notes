"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, MessageSquare, MoreHorizontal, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notify } from "@/components/ui/toaster";
import { SmartComposer } from "@/components/ui/smart-composer";
import { useChatStore, type ChatConversation } from "@/lib/store/chat-store";
import {
  createConversation,
  archiveConversation,
  restoreConversation,
  deleteConversation,
} from "@/app/(app)/chat-actions";

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

interface ChatListProps {
  /** If true renders a compact version for the sidebar */
  compact?: boolean;
  /** Maximum items to show in compact mode */
  maxItems?: number;
}

export function ChatList({ compact = false, maxItems }: ChatListProps) {
  const router = useRouter();
  const conversations = useChatStore((s) => s.conversations);
  const isLoaded = useChatStore((s) => s.isLoaded);
  const removeConversation = useChatStore((s) => s.removeConversation);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const addConv = useChatStore((s) => s.addConversation);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const activeConversations = conversations.filter((c) => c.status === "active");
  const archivedConversations = conversations.filter((c) => c.status === "archived");

  const displayItems = compact
    ? activeConversations.slice(0, maxItems ?? 3)
    : activeConversations;

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
      if (allowedSourceTypes.length < 4) {
        query.set("sources", allowedSourceTypes.join(","));
      }
      const qs = query.toString();
      const targetUrl = qs
        ? `/chats/${result.conversationId}?${qs}`
        : `/chats/${result.conversationId}`;
      router.push(targetUrl);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleArchive(conv: ChatConversation) {
    const res = await archiveConversation(conv.id);
    if (res.error) {
      notify.error(res.error);
      return;
    }
    updateConversation(conv.id, { status: "archived" });
    notify.success("Conversa arquivada.");
  }

  async function handleRestore(conv: ChatConversation) {
    const res = await restoreConversation(conv.id);
    if (res.error) {
      notify.error(res.error);
      return;
    }
    updateConversation(conv.id, { status: "active" });
    notify.success("Conversa restaurada.");
  }

  async function handleDelete(id: string) {
    const res = await deleteConversation(id);
    if (res.error) {
      notify.error(res.error);
      return;
    }
    removeConversation(id);
    notify.success("Conversa excluída.");
  }

  function ConversationItem({ conv }: { conv: ChatConversation }) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0 }}
        className="group"
      >
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-2xl px-3 py-2.5 transition-colors",
            compact ? "hover:bg-secondary" : "bg-secondary hover:bg-surface"
          )}
        >
          <Link
            href={`/chats/${conv.id}`}
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <MessageSquare className="size-3.5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13.5px] font-medium text-foreground transition-colors group-hover:text-accent">
                {conv.title}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {formatRelativeTime(conv.updatedAt)}
              </span>
            </div>
          </Link>

          {conv.status === "archived" && (
            <Badge variant="outline" className="shrink-0 text-[9px]">
              Arquivada
            </Badge>
          )}

          {!compact && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Opções"
                  className="shrink-0 rounded-full p-1 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {conv.status === "active" ? (
                  <DropdownMenuItem onSelect={() => void handleArchive(conv)}>
                    <Archive className="size-4" />
                    Arquivar
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => void handleRestore(conv)}>
                    <ArchiveRestore className="size-4" />
                    Restaurar
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setConfirmDeleteId(conv.id)}
                >
                  <Trash2 className="size-4" />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </motion.div>
    );
  }

  if (compact) {
    if (!isLoaded) {
      return (
        <div className="flex flex-col gap-1 py-0.5">
          {Array.from({ length: maxItems ?? 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-2xl px-3 py-2">
              <Skeleton className="size-7 shrink-0 rounded-xl" />
              <div className="flex flex-1 flex-col gap-1.5 min-w-0">
                <Skeleton className="h-3.5 w-24 rounded-md" />
                <Skeleton className="h-2.5 w-10 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-0.5">
        {displayItems.map((conv) => (
          <ConversationItem key={conv.id} conv={conv} />
        ))}
        {activeConversations.length > (maxItems ?? 3) && (
          <Link
            href="/chats"
            className="px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-accent"
          >
            Ver todas →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg">Conversas</h2>
      </div>

      {displayItems.length === 0 && archivedConversations.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma conversa ainda. Digite sua pergunta abaixo para começar.
        </p>
      )}

      <AnimatePresence mode="popLayout">
        {displayItems.map((conv) => (
          <ConversationItem key={conv.id} conv={conv} />
        ))}
      </AnimatePresence>

      {archivedConversations.length > 0 && (
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-muted-foreground">
            ARQUIVADAS
          </span>
          <AnimatePresence mode="popLayout">
            {archivedConversations.map((conv) => (
              <ConversationItem key={conv.id} conv={conv} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <ConfirmVault
        open={!!confirmDeleteId}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
        title="Excluir conversa?"
        description="A conversa e todas as mensagens serão excluídas permanentemente."
        confirmLabel="Excluir"
        onConfirm={() => {
          if (confirmDeleteId) void handleDelete(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </div>
  );
}
