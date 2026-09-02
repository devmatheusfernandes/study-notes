import { Skeleton } from "@/components/ui/skeleton";

export default function NoteLoading() {
  return (
    <div className="flex flex-1 flex-col animate-pulse">
      <header className="flex items-center gap-2 px-4 py-3 sm:px-6">
        <Skeleton className="h-8 w-20 rounded-full" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-4 pb-16 sm:px-6">
        <Skeleton className="h-10 w-3/4 rounded-xl" />
        <Skeleton className="h-4 w-28 rounded-md" />
        <div className="flex flex-col gap-3 pt-4">
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-4 w-[92%] rounded-md" />
          <Skeleton className="h-4 w-[85%] rounded-md" />
          <Skeleton className="h-4 w-[96%] rounded-md" />
          <Skeleton className="h-4 w-[70%] rounded-md" />
        </div>
      </div>
    </div>
  );
}
