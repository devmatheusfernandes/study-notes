"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { searchWol, type WolSearchHit } from "@/app/(app)/wol-actions";
import { BibleVerseSearchSkeleton } from "./bible-search-skeleton";

interface WolSearchPanelProps {
  query: string;
  /** True while the "WOL" tab is showing. The search itself is lazy — see below. */
  active: boolean;
  /** A result was clicked — the reader opens it in the side panel (see BibleSearchDetailPanel). */
  onOpen: (docId: number, title: string) => void;
}

/** `hit.headline` is escaped server-side with `<mark>` as the only markup — same contract as Highlighted in bible-search-results.tsx. */
function Headline({ html }: { html: string }) {
  return (
    <span
      className="whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/90 [&_mark]:rounded [&_mark]:bg-accent/25 [&_mark]:px-0.5 [&_mark]:text-accent"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** A later page can repeat a document an earlier one already listed — WOL pages by occurrence, not by document. */
function mergeHits(prev: WolSearchHit[], next: WolSearchHit[]): WolSearchHit[] {
  const seen = new Set(prev.map((hit) => hit.docId));
  return [...prev, ...next.filter((hit) => !seen.has(hit.docId))];
}

/**
 * The Bible search's "WOL" tab: the results list from wol.jw.org. WOL can't be
 * framed (`X-Frame-Options: SAMEORIGIN`), so the server fetches and rewrites it
 * (app/(app)/wol-actions.ts); opening a result shows it in the shared side
 * panel/Vault, like every other kind of result here.
 *
 * The search runs the first time the tab is opened for a given query, not with
 * the other three — it's a live request to someone else's server, so it isn't
 * spent on a search whose user never looks at this tab.
 */
export function WolSearchPanel({ query, active, onOpen }: WolSearchPanelProps) {
  const [hits, setHits] = useState<WolSearchHit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);

  const activeQueryRef = useRef(query);
  useEffect(() => {
    activeQueryRef.current = query;
  }, [query]);

  useEffect(() => {
    if (!active || searchedQuery === query) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsLoading(true);
    });

    void searchWol(query, 1).then((result) => {
      if (cancelled) return;
      setHits(mergeHits([], result.hits ?? []));
      setHasMore(result.hasMore ?? false);
      setPage(1);
      setSearchedQuery(query);
      setIsLoading(false);
      if (result.error) notify.error("Não foi possível buscar", result.error);
    });

    return () => {
      cancelled = true;
    };
  }, [active, query, searchedQuery]);

  const loadMore = useCallback(() => {
    const requested = query;
    setIsLoadingMore(true);
    void searchWol(requested, page + 1).then((result) => {
      if (activeQueryRef.current !== requested) return;
      setHits((prev) => mergeHits(prev, result.hits ?? []));
      setHasMore(result.hasMore ?? false);
      setPage((prev) => prev + 1);
      setIsLoadingMore(false);
      if (result.error) notify.error("Não foi possível carregar mais", result.error);
    });
  }, [query, page]);

  if (isLoading || searchedQuery !== query) return <BibleVerseSearchSkeleton />;

  if (hits.length === 0) {
    return (
      <p className="py-10 text-center text-[13px] text-muted-foreground">
        Nenhum resultado na Biblioteca On-line para “{query}”.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {hits.map((hit) => (
        <button
          key={hit.docId}
          type="button"
          onClick={() => onOpen(hit.docId, hit.title)}
          className="flex flex-col gap-1 rounded-2xl bg-secondary px-4 py-3 text-left transition-colors hover:bg-surface-elevated"
        >
          <span className="flex items-center gap-2">
            <Badge variant="outline" className="shrink-0">
              WOL
            </Badge>
            <span className="min-w-0 truncate font-mono text-[10.5px] tracking-[0.04em] text-accent">
              {hit.title}
            </span>
            {hit.count && (
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{hit.count}</span>
            )}
          </span>
          <Headline html={hit.headline} />
          {hit.source && <span className="text-[11.5px] text-muted-foreground">{hit.source}</span>}
        </button>
      ))}
      {hasMore && (
        <Button variant="ghost" size="sm" className="self-center" isLoading={isLoadingMore} onClick={loadMore}>
          Carregar mais
        </Button>
      )}
    </div>
  );
}
