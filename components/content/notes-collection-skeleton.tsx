import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function NoteCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5 shadow-sm",
        className
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="size-4 shrink-0 rounded-full" />
        </div>
        <Skeleton className="h-5 w-4/5 rounded-md" />
        <div className="flex flex-col gap-1.5 pt-1">
          <Skeleton className="h-3 w-full rounded" />
          <Skeleton className="h-3 w-4/5 rounded" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-4">
        <Skeleton className="h-3 w-20 rounded" />
        <Skeleton className="h-3 w-24 rounded-full" />
      </div>
    </div>
  );
}

/** Placeholder shown while the leaf page for a NotesCollection route streams in. */
export function NotesCollectionSkeleton() {
  return (
    <div className="relative flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 pb-24">
      {/* Pinned Section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16 rounded" />
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <NoteCardSkeleton className="min-h-[170px]" />
          <NoteCardSkeleton className="min-h-[170px]" />
        </div>
      </div>

      {/* Other Section */}
      <div className="flex flex-col gap-3 pt-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16 rounded" />
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <NoteCardSkeleton className="min-h-[180px]" />
          <NoteCardSkeleton className="min-h-[150px]" />
          <NoteCardSkeleton className="min-h-[170px]" />
          <NoteCardSkeleton className="min-h-[150px]" />
        </div>
      </div>

      {/* Floating Bottom Prompt Dock Skeleton */}
      <div className="fixed bottom-4 left-1/2 z-20 w-full max-w-xl -translate-x-1/2 px-4 pointer-events-none">
        <div className="flex h-12 w-full items-center justify-between gap-3 rounded-full border border-border/80 bg-card/90 px-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3.5 w-48 sm:w-64 rounded-full" />
          </div>
          <Skeleton className="size-8 rounded-full" />
        </div>
      </div>
    </div>
  );
}
