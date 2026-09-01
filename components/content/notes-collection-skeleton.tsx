import { Skeleton } from "@/components/ui/skeleton";

const CARD_HEIGHTS = ["h-36", "h-24", "h-48", "h-28", "h-40", "h-32", "h-52", "h-24"];

/** Placeholder shown while the leaf page for a NotesCollection route streams in. */
export function NotesCollectionSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-7 px-4 py-6 sm:px-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-16" />
        <Skeleton className="hidden h-16 sm:block" />
        <Skeleton className="hidden h-16 lg:block" />
      </div>

      <div className="columns-2 gap-3 md:columns-3 xl:columns-4 [&>*]:mb-3">
        {CARD_HEIGHTS.map((height, i) => (
          <Skeleton key={i} className={height} />
        ))}
      </div>
    </div>
  );
}
