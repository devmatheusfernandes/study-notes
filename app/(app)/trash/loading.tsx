import { HeaderSkeleton } from "@/components/layout/header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function TrashLoading() {
  return (
    <>
      <HeaderSkeleton variant="search" />
      <main className="relative flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 pb-24">
        {/* Section Header */}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3.5 w-32 rounded font-mono" />
          
          {/* Card Grid */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div className="flex flex-col justify-between rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5 shadow-sm min-h-[140px]">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-12 rounded-full" />
                  <Skeleton className="size-4 rounded-full" />
                </div>
                <Skeleton className="h-5 w-3/4 rounded-md" />
              </div>
              <div className="flex items-center justify-between pt-4">
                <Skeleton className="h-3 w-20 rounded" />
                <Skeleton className="h-3 w-24 rounded-full" />
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5 shadow-sm min-h-[140px]">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="size-4 rounded-full" />
                </div>
                <Skeleton className="h-5 w-2/3 rounded-md" />
              </div>
              <div className="flex items-center justify-between pt-4">
                <Skeleton className="h-3 w-20 rounded" />
                <Skeleton className="h-3 w-24 rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Floating Bottom Prompt Bar */}
        <div className="fixed bottom-4 left-1/2 z-20 w-full max-w-xl -translate-x-1/2 px-4 pointer-events-none">
          <div className="flex h-12 w-full items-center justify-between gap-3 rounded-full border border-border/80 bg-card/90 px-4 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3.5 w-48 sm:w-64 rounded-full" />
            </div>
            <Skeleton className="size-8 rounded-full" />
          </div>
        </div>
      </main>
    </>
  );
}
