import { HeaderSkeleton } from "@/components/layout/header-skeleton";
import { NotesCollectionSkeleton } from "@/components/content/notes-collection-skeleton";

export default function TrashLoading() {
  return (
    <>
      <HeaderSkeleton variant="search" />
      <NotesCollectionSkeleton />
    </>
  );
}
