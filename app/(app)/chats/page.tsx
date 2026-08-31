import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export const metadata: Metadata = {
  title: "Chats — Study Notes",
};

export default function ChatsPage() {
  return (
    <>
      <Header variant="title" title="Chats" />
      <main className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquare />
            </EmptyMedia>
            <EmptyTitle>Nenhuma conversa ainda</EmptyTitle>
            <EmptyDescription>
              Pergunte às suas notas e arquivos — o assistente responde direto das suas fontes.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    </>
  );
}
