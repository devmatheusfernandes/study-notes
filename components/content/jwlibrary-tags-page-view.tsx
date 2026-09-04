"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listOwnJwlibraryTags, type JwlibraryTagView } from "@/app/(app)/jwlibrary-actions";
import { JwlibraryTagManagerList } from "./jwlibrary-tag-manager-list";

/** Full-page counterpart to jwlibrary-tag-manager-vault.tsx, reached from /jwlibrary's "Gerenciar tags" toolbar button. */
export function JwlibraryTagsPageView() {
  const [tags, setTags] = useState<JwlibraryTagView[]>([]);

  function refresh() {
    void listOwnJwlibraryTags().then((result) => setTags(result.tags ?? []));
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/jwlibrary"
        className="flex w-fit items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[13px] text-foreground/80 transition-colors hover:bg-surface"
      >
        <ChevronLeft className="size-4" />
        Estudo Pessoal
      </Link>

      <JwlibraryTagManagerList tags={tags} onRefresh={refresh} />
    </div>
  );
}
