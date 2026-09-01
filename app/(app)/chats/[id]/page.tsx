import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getConversationMessages } from "@/app/(app)/chat-actions";
import { ChatView } from "@/components/chat/chat-view";
import { ChatMessagesHydration } from "@/components/chat/chat-messages-hydration";
import type { ChatMessage } from "@/lib/store/chat-store";

interface ChatPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ChatPageProps) {
  const { id } = await params;
  const { title } = await getConversationMessages(id);
  return { title: title ? `${title} — Study Notes` : "Chat — Study Notes" };
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { id } = await params;
  const { messages: rows, title } = await getConversationMessages(id);

  if (!title) redirect("/chats");

  const messages: ChatMessage[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    sources: r.sources,
    createdAt: r.createdAt,
  }));

  return (
    <>
      <ChatMessagesHydration conversationId={id} messages={messages} />

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
        <Link
          href="/chats"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Voltar para conversas"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="truncate font-heading text-base">{title}</h1>
      </header>

      <ChatView conversationId={id} />
    </>
  );
}
