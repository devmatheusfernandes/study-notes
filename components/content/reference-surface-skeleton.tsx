import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholders for the "clicked a reference" side panels — the Bible
 * surface, the publication/footnote/extract/appendix surfaces and the video
 * surface. These replace the single pulsing-dot "carregando…" line those
 * panels all used to share: the panel opens instantly with the shape of the
 * content it's about to show, so the wait reads as the text arriving rather
 * than as nothing having happened.
 *
 * Deliberately one module for all of them — the panels are the same shell
 * (`JwpubSidePanel`) at the same width, so their placeholders should agree.
 */

/** Cited verse text: the reference label, then a few verse lines with their verse numbers. */
export function BibleVerseSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-3 w-28 rounded-md" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((verse) => (
          <div key={verse} className="flex gap-2">
            <Skeleton className="mt-0.5 h-2.5 w-3 shrink-0 rounded-sm" />
            <div className="flex w-full flex-col gap-1.5">
              <Skeleton className="h-3.5 w-full rounded-md" />
              <Skeleton className="h-3.5 w-[92%] rounded-md" />
              <Skeleton className={verse === 1 ? "h-3.5 w-[60%] rounded-md" : "h-3.5 w-[74%] rounded-md"} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Prose pulled out of a publication — a chapter, a footnote, an excerpt, an
 * appendix. `paragraphs` tunes how much is drawn: a footnote is a couple of
 * lines, a chapter is a screenful.
 */
export function ReferenceContentSkeleton({ paragraphs = 3, withHeading = false }: { paragraphs?: number; withHeading?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {withHeading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20 rounded-md" />
          <Skeleton className="h-5 w-4/5 rounded-xl" />
        </div>
      )}
      {Array.from({ length: paragraphs }, (_, block) => (
        <div key={block} className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-full rounded-md" />
          <Skeleton className="h-3.5 w-[95%] rounded-md" />
          <Skeleton className="h-3.5 w-[88%] rounded-md" />
          <Skeleton className="h-3.5 w-[64%] rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** A video card: 16:9 cover, then title and duration lines. */
export function VideoSurfaceSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="aspect-video w-full rounded-2xl" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-4/5 rounded-md" />
        <Skeleton className="h-3 w-16 rounded-md" />
      </div>
    </div>
  );
}
