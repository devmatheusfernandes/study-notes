"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { HeaderSkeleton } from "@/components/layout/header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SmartComposer } from "@/components/ui/smart-composer";
import { ChatMessage } from "./chat-message";

function ConversationListLoading() {
  return (
    <>
      <HeaderSkeleton variant="title" />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <div className="flex w-full flex-col gap-6">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-6 w-28 rounded-lg" />
            <Skeleton className="h-8 w-32 rounded-full" />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 p-3.5">
              <Skeleton className="size-8 shrink-0 rounded-xl" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-48 rounded-md" />
                <Skeleton className="h-3 w-12 rounded-md" />
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 p-3.5">
              <Skeleton className="size-8 shrink-0 rounded-xl" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-40 rounded-md" />
                <Skeleton className="h-3 w-10 rounded-md" />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <Skeleton className="h-3 w-24 rounded font-mono" />
            <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 p-3.5">
              <Skeleton className="size-8 shrink-0 rounded-xl" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-36 rounded-md" />
                <Skeleton className="h-3 w-12 rounded-md" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

/**
 * The shell of an open chat, drawn while the real page is still being fetched.
 *
 * Same markup and geometry as app/(app)/chats/[id]/page.tsx + ChatView — the
 * header, the message column, the floating composer — so when the real chat
 * mounts nothing moves. And when the chat was just started from the list
 * (`?q=`), it already shows what the person asked and the assistant "thinking"
 * placeholder, rather than fake grey bubbles that the real messages then
 * replace.
 */
function ConversationLoading({ question }: { question: string }) {
  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
        <span className="flex size-8 items-center justify-center rounded-full text-muted-foreground">
          <ArrowLeft className="size-4" />
        </span>
        {question ? (
          <h1 className="truncate font-heading text-base">{question.slice(0, 60)}</h1>
        ) : (
          <Skeleton className="h-5 w-40 rounded-full" />
        )}
      </header>

      <div className="relative flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-6 pb-32 sm:px-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-4 sm:max-w-3xl">
            {question ? (
              <>
                <ChatMessage role="user" content={question} sources={[]} instant />
                <ChatMessage role="assistant" content="" sources={[]} isStreaming instant />
              </>
            ) : (
              <>
                <div className="flex justify-end">
                  <Skeleton className="h-10 w-2/3 rounded-[20px_20px_6px_20px]" />
                </div>
                <div className="flex items-start gap-2.5">
                  <Skeleton className="mt-1 size-6 shrink-0 rounded-full" />
                  <Skeleton className="h-16 w-3/4 rounded-[20px_20px_20px_6px]" />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-20 px-4 sm:px-6">
          <div className="pointer-events-auto mx-auto max-w-2xl sm:max-w-3xl">
            <SmartComposer
              variant="chat"
              onSend={() => {}}
              disabled
              statusText={question ? "Enviando…" : undefined}
              placeholder="Pergunte às suas notas ou vídeos…"
            />
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The one loading state for everything under /chats.
 *
 * Next shows the NEAREST loading boundary it already knows about while a
 * navigation is in flight. Going from the list to a brand-new chat, the
 * `[id]` segment's own loading.tsx isn't known yet, so the list's was shown
 * first (a list skeleton), then replaced by the chat's skeleton, then by the
 * chat — three different screens for one navigation. Deciding by the target
 * URL here makes the first thing on screen already the right one, and it
 * matches what the real chat renders next.
 */
export function ChatsLoading() {
  const pathname = usePathname();
  const question = useSearchParams().get("q")?.trim() ?? "";
  const isConversation = /^\/chats\/[^/]+/.test(pathname);

  return isConversation ? <ConversationLoading question={question} /> : <ConversationListLoading />;
}
