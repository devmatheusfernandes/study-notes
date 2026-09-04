import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function JwlibraryNoteCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2.5 rounded-2xl bg-secondary p-4", className)}>
      <div className="flex items-center gap-2">
        <Skeleton className="size-2.5 shrink-0 rounded-full" />
        <Skeleton className="h-3 w-28 rounded" />
      </div>
      <Skeleton className="h-4 w-3/5 rounded-md" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-4/5 rounded" />
      </div>
    </div>
  );
}

/** Shown by jwlibrary-notes-collection.tsx while the initial note/tag list loads, instead of a plain "carregando…" line — mirrors notes-collection-skeleton.tsx's pattern for the real card shape used there. */
export function JwlibraryNotesSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-2.5">
      <JwlibraryNoteCardSkeleton />
      <JwlibraryNoteCardSkeleton />
      <JwlibraryNoteCardSkeleton />
      <JwlibraryNoteCardSkeleton />
    </div>
  );
}
