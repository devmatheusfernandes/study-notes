import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { listConversations } from "@/app/(app)/chat-actions";
import { ChatList } from "@/components/chat/chat-list";
import { ChatHydration } from "@/components/chat/chat-hydration";

export const metadata: Metadata = {
  title: "Chats — Study Notes",
};

export default async function ChatsPage() {
  const rows = await listConversations();

  const conversations = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    updatedAt: r.updatedAt,
  }));

  return (
    <>
      <ChatHydration conversations={conversations} />
      <Header variant="title" title="Chats" />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <ChatList />
        </div>
      </main>
    </>
  );
}
