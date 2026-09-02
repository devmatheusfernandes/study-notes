import { HeaderSkeleton } from "@/components/layout/header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function ChatsLoading() {
  return (
    <>
      <HeaderSkeleton variant="title" />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          {/* Conversas Header */}
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-6 w-28 rounded-lg" />
            <Skeleton className="h-8 w-32 rounded-full" />
          </div>

          {/* Active Conversations Skeletons */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 p-3.5">
              <Skeleton className="size-8 shrink-0 rounded-xl" />
              <div className="flex flex-1 flex-col gap-1.5 min-w-0">
                <Skeleton className="h-4 w-48 rounded-md" />
                <Skeleton className="h-3 w-12 rounded-md" />
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 p-3.5">
              <Skeleton className="size-8 shrink-0 rounded-xl" />
              <div className="flex flex-1 flex-col gap-1.5 min-w-0">
                <Skeleton className="h-4 w-40 rounded-md" />
                <Skeleton className="h-3 w-10 rounded-md" />
              </div>
            </div>
          </div>

          {/* Archived Section */}
          <div className="flex flex-col gap-3 pt-4">
            <Skeleton className="h-3 w-24 rounded font-mono" />
            <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 p-3.5">
              <Skeleton className="size-8 shrink-0 rounded-xl" />
              <div className="flex flex-1 flex-col gap-1.5 min-w-0">
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
