import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors Header's own markup (same height/spacing) so the loading.tsx
 * boundary Next.js prefetches for these dynamic routes doesn't visibly
 * shift the layout once the real Header streams in behind it.
 */
export function HeaderSkeleton({ variant }: { variant: "search" | "title" }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:gap-3 sm:px-6">
      <Skeleton className="size-8 shrink-0 rounded-full" />

      {variant === "search" ? (
        <Skeleton className="h-9 min-w-0 flex-1 rounded-full sm:max-w-sm" />
      ) : (
        <Skeleton className="h-6 w-40 rounded-full" />
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="size-9 rounded-full" />
      </div>
    </header>
  );
}
