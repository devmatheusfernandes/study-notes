import { Skeleton } from "@/components/ui/skeleton";

/**
 * Without this file, Next.js fell back to the parent segment's
 * app/(app)/chats/loading.tsx (a conversation-*list* skeleton) for every
 * `/chats/[id]` navigation too — visibly the wrong shape (fake list rows)
 * for a split second before the real chat mounted. This mirrors the actual
 * header + message-bubble layout in page.tsx/chat-view.tsx instead, so the
 * transition reads as one continuous load rather than a shape change.
 */
export default function ChatConversationLoading() {
  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <Skeleton className="h-5 w-40 rounded-full" />
      </header>

      <div className="flex-1 px-4 pt-6 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 sm:max-w-3xl">
          <div className="flex justify-end">
            <Skeleton className="h-10 w-2/3 rounded-[20px_20px_6px_20px]" />
          </div>
          <div className="flex items-start gap-2.5">
            <Skeleton className="mt-1 size-6 shrink-0 rounded-full" />
            <Skeleton className="h-16 w-3/4 rounded-[20px_20px_20px_6px]" />
          </div>
        </div>
      </div>
    </>
  );
}
