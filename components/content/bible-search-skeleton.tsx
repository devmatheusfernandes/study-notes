import { Skeleton } from "@/components/ui/skeleton";

/** One verse hit while a search is in flight — mirrors the real result button's `rounded-2xl bg-secondary px-4 py-3` shape with a reference label bar and two lines of excerpt. */
function VerseHitSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-secondary px-4 py-3">
      <Skeleton className="h-2.5 w-20 rounded" />
      <Skeleton className="h-3 w-full rounded" />
      <Skeleton className="h-3 w-3/4 rounded" />
    </div>
  );
}

/** Shown by BibleSearchResults' Versículos tab while `searchBibleAndVideos` is in flight. */
export function BibleVerseSearchSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-2">
      <VerseHitSkeleton />
      <VerseHitSkeleton />
      <VerseHitSkeleton />
      <VerseHitSkeleton />
    </div>
  );
}

/** One video hit while a search is in flight — mirrors the real result's thumbnail-plus-excerpt shape. */
function VideoHitSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-secondary px-3 py-3">
      <Skeleton className="aspect-video w-24 shrink-0 rounded-xl sm:w-32" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-2/3 rounded" />
        <Skeleton className="h-3 w-4/5 rounded" />
      </div>
    </div>
  );
}

/** Shown by BibleSearchResults' Vídeos tab while `searchBibleAndVideos` is in flight. */
export function BibleVideoSearchSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-2">
      <VideoHitSkeleton />
      <VideoHitSkeleton />
      <VideoHitSkeleton />
    </div>
  );
}
