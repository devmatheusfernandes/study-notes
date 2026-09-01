import { HeaderSkeleton } from "@/components/layout/header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <>
      <HeaderSkeleton variant="title" />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-10 w-full max-w-sm rounded-full" />
          <Skeleton className="h-40 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
        </div>
      </main>
    </>
  );
}
