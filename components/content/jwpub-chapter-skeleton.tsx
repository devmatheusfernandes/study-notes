import { Skeleton } from "@/components/ui/skeleton";

/** Shown by jwpub-reader.tsx while a chapter's HTML is loading — both on first open and when switching pages — instead of a plain "carregando…" line. Shape mirrors a real chapter: a heading, a pull-quote-style verse, then body paragraphs. */
export function JwpubChapterSkeleton() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 animate-pulse">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3 w-24 rounded-md" />
        <Skeleton className="h-7 w-5/6 rounded-xl" />
        <Skeleton className="h-4 w-3/5 rounded-md" />
      </div>
      {[0, 1, 2].map((block) => (
        <div key={block} className="flex flex-col gap-2.5">
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-4 w-[94%] rounded-md" />
          <Skeleton className="h-4 w-[88%] rounded-md" />
          <Skeleton className="h-4 w-[70%] rounded-md" />
        </div>
      ))}
    </div>
  );
}
