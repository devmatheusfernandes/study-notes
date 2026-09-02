import { HeaderSkeleton } from "@/components/layout/header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <>
      <HeaderSkeleton variant="title" />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <div className="flex w-full flex-col gap-6">
          {/* Profile Hero Header Skeleton */}
          <div className="flex h-24 w-full items-center justify-between rounded-3xl border border-border/60 bg-card/60 p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="size-14 shrink-0 rounded-2xl" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-48 rounded-md" />
                <Skeleton className="h-3 w-60 rounded-md" />
              </div>
            </div>
            <Skeleton className="h-9 w-28 rounded-full max-sm:hidden" />
          </div>

          {/* Filter Pills Skeleton */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Skeleton className="h-9 w-40 shrink-0 rounded-full" />
            <Skeleton className="h-9 w-36 shrink-0 rounded-full" />
            <Skeleton className="h-9 w-28 shrink-0 rounded-full" />
            <Skeleton className="h-9 w-40 shrink-0 rounded-full" />
          </div>

          {/* Bento Grid Skeleton */}
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Skeleton className="h-72 rounded-3xl" />
              <Skeleton className="h-72 rounded-3xl" />
            </div>
            <Skeleton className="h-64 rounded-3xl" />
            <Skeleton className="h-48 rounded-3xl" />
          </div>
        </div>
      </main>
    </>
  );
}
