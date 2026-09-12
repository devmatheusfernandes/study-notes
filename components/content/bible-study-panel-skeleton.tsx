import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** One reference/note/footnote row while its list loads — mirrors the real `rounded-2xl bg-secondary px-4 py-3` card these tabs already render, just with bars instead of text. */
function StudyRowSkeleton({ withIndex = false }: { withIndex?: boolean }) {
  return (
    <div className={cn("flex gap-2.5 rounded-2xl bg-secondary px-4 py-3", !withIndex && "flex-col")}>
      {withIndex && <Skeleton className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded" />}
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-4/5 rounded" />
      </div>
    </div>
  );
}

/**
 * Shown by the Refs/Notas/Rodapé tabs while their content loads, instead of a
 * plain "carregando…" line — three rows is enough to read as "a list is
 * coming" without overshooting a chapter that only has one or two.
 */
export function BibleStudyRowsSkeleton({ withIndex = false }: { withIndex?: boolean }) {
  return (
    <div className="flex animate-pulse flex-col gap-3">
      <StudyRowSkeleton withIndex={withIndex} />
      <StudyRowSkeleton withIndex={withIndex} />
      <StudyRowSkeleton withIndex={withIndex} />
    </div>
  );
}

/** One video row while the Vídeos tab loads — mirrors `VideoRow`'s thumbnail-plus-two-lines shape in bible-study-panel.tsx. */
function VideoRowSkeleton() {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-secondary px-2.5 py-2.5">
      <Skeleton className="aspect-video w-20 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-3/5 rounded" />
        <Skeleton className="h-2.5 w-1/3 rounded" />
      </div>
    </div>
  );
}

/** Shown by the Vídeos tab while `getChapterVideos` is in flight. */
export function BibleStudyVideosSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-1.5">
      <VideoRowSkeleton />
      <VideoRowSkeleton />
      <VideoRowSkeleton />
    </div>
  );
}
