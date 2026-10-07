"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, BookMarked, BookOpen, Film, Globe, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/toaster";
import { parseBibleReference, formatBibleReference } from "@/lib/bible/parse-reference";
import { WolSearchPanel } from "./wol-search-panel";
import { BibleVerseSearchSkeleton, BibleVideoSearchSkeleton, BibleInsightSearchSkeleton } from "./bible-search-skeleton";
import { BIBLE_SEARCH_PAGE_SIZE, BIBLE_SEARCH_MIN_LENGTH } from "@/lib/bible/search-config";
import {
  searchBibleAndVideos,
  searchBibleVerses,
  searchVideoTranscripts,
  searchInsightChapters,
  searchResearchGuideExtracts,
  type BibleVerseHit,
  type VideoHit,
  type InsightHit,
  type GuideHit,
} from "@/app/(app)/bible-search-actions";
import type { BibleSearchDetail } from "./bible-search-detail-panel";

interface BibleSearchResultsProps {
  query: string;
  /** Opens a verse in the reading screen — the same `enterReading` the rest of the reader uses. */
  onSelectVerse: (bookOrder: number, chapter: number, verse: number | null) => void;
  /** A video, Perspicaz article, Guia excerpt or WOL document was clicked — the reader shows it in the side panel (BibleSearchDetailPanel). */
  onOpenDetail: (detail: BibleSearchDetail) => void;
}

type ResultsTab = "versiculos" | "videos" | "perspicaz" | "biblioteca";

/**
 * `headline` arrives already escaped from the server, with `<mark>` as the only
 * markup in it — see `toHighlightedHtml` in app/(app)/bible-search-actions.ts,
 * which escapes the whole string before swapping in the sentinel characters
 * ts_headline used. A transcript is third-party text (JW.org subtitle files),
 * so this is the one place it's allowed to become markup, and only because the
 * tags were added after escaping rather than found in the text.
 */
function Highlighted({ html, className }: { html: string; className?: string }) {
  return (
    <span
      className={cn("[&_mark]:rounded [&_mark]:bg-accent/25 [&_mark]:px-0.5 [&_mark]:text-accent", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/**
 * The Bible reader's fourth screen: everything matching what's typed in the
 * header, split into the Bible's own text and the JW.org video transcripts.
 *
 * Searching is server-side (Postgres full-text, accent-insensitive — see
 * migration 0025), because neither corpus can live in the browser: 31.194
 * verses and 16 MB of transcripts.
 */
export function BibleSearchResults({ query, onSelectVerse, onOpenDetail }: BibleSearchResultsProps) {
  const [tab, setTab] = useState<ResultsTab>("versiculos");
  const tabsListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabsListRef.current
      ?.querySelector<HTMLElement>("[data-slot=tabs-trigger][data-active]")
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [tab]);
  const [verses, setVerses] = useState<BibleVerseHit[]>([]);
  const [videos, setVideos] = useState<VideoHit[]>([]);
  const [articles, setArticles] = useState<InsightHit[]>([]);
  const [guide, setGuide] = useState<GuideHit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMoreVerses, setIsLoadingMoreVerses] = useState(false);
  const [isLoadingMoreVideos, setIsLoadingMoreVideos] = useState(false);
  const [isLoadingMoreArticles, setIsLoadingMoreArticles] = useState(false);
  const [isLoadingMoreGuide, setIsLoadingMoreGuide] = useState(false);
  const [versesExhausted, setVersesExhausted] = useState(false);
  const [videosExhausted, setVideosExhausted] = useState(false);
  const [articlesExhausted, setArticlesExhausted] = useState(false);
  const [guideExhausted, setGuideExhausted] = useState(false);

  // A query that IS a reference ("João 3:16", "sl 23") gets a direct jump
  // offered above the results. Resolved in the browser against the static
  // table in lib/bible/parse-reference.ts — no round trip, and it answers the
  // single most common thing typed into a Bible search box, which full-text
  // search itself handles badly (searching for "João 3:16" matches the *word*
  // João, i.e. every genealogy in the Bible).
  const jump = parseBibleReference(query.trim());

  // Sempre a consulta mais recente, para que uma página de "carregar mais" que
  // chegue atrasada saiba que já não pertence à busca atual. Um ref, não a
  // variável `query` fechada na callback — aquela guarda o valor de quando a
  // callback foi criada, que é exatamente o valor com que a comparação seria
  // feita, e a checagem nunca falharia.
  const activeQueryRef = useRef(query);
  useEffect(() => {
    activeQueryRef.current = query;
  }, [query]);

  useEffect(() => {
    const trimmed = query.trim();
    // Nada a limpar: com menos que o mínimo o componente já devolve a dica
    // antes de chegar às listas, então o resultado anterior nunca chega a ser
    // desenhado, e a próxima busca o substitui inteiro.
    if (trimmed.length < BIBLE_SEARCH_MIN_LENGTH) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsLoading(true);
    });

    void searchBibleAndVideos(trimmed).then((result) => {
      if (cancelled) return;
      setVerses(result.verses);
      setVideos(result.videos);
      setArticles(result.articles);
      setGuide(result.guide);
      setVersesExhausted(result.verses.length < BIBLE_SEARCH_PAGE_SIZE);
      setVideosExhausted(result.videos.length < BIBLE_SEARCH_PAGE_SIZE);
      setArticlesExhausted(result.articles.length < BIBLE_SEARCH_PAGE_SIZE);
      setGuideExhausted(result.guide.length < BIBLE_SEARCH_PAGE_SIZE);
      setIsLoading(false);
      // Uma nova busca substitui as listas, então qualquer "carregar mais"
      // ainda em voo foi abandonado — sem zerar estes, o botão ficaria
      // girando para sempre.
      setIsLoadingMoreVerses(false);
      setIsLoadingMoreVideos(false);
      setIsLoadingMoreArticles(false);
      setIsLoadingMoreGuide(false);
      if (result.error) notify.error("Não foi possível buscar", result.error);
      // Land on whichever list actually has something, so a query that only
      // matches videos/Perspicaz doesn't open on an empty "Versículos" tab.
      if (result.verses.length === 0 && result.videos.length > 0) setTab("videos");
      else if (result.verses.length === 0 && result.videos.length === 0 && (result.articles.length > 0 || result.guide.length > 0)) setTab("perspicaz");
      else setTab("versiculos");
    });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const loadMoreVerses = useCallback(() => {
    const requested = query.trim();
    setIsLoadingMoreVerses(true);
    void searchBibleVerses(requested, verses.length).then((result) => {
      // Uma página que chega depois de a busca ter mudado pertence à consulta
      // anterior — anexá-la misturaria resultados de duas buscas na mesma
      // lista.
      if (activeQueryRef.current.trim() !== requested) return;
      const page = result.verses ?? [];
      setVerses((prev) => [...prev, ...page]);
      setVersesExhausted(page.length < BIBLE_SEARCH_PAGE_SIZE);
      setIsLoadingMoreVerses(false);
    });
  }, [query, verses.length]);

  const loadMoreVideos = useCallback(() => {
    const requested = query.trim();
    setIsLoadingMoreVideos(true);
    void searchVideoTranscripts(requested, videos.length).then((result) => {
      if (activeQueryRef.current.trim() !== requested) return;
      const page = result.videos ?? [];
      setVideos((prev) => [...prev, ...page]);
      setVideosExhausted(page.length < BIBLE_SEARCH_PAGE_SIZE);
      setIsLoadingMoreVideos(false);
    });
  }, [query, videos.length]);

  const loadMoreArticles = useCallback(() => {
    const requested = query.trim();
    setIsLoadingMoreArticles(true);
    void searchInsightChapters(requested, articles.length).then((result) => {
      if (activeQueryRef.current.trim() !== requested) return;
      const page = result.articles ?? [];
      setArticles((prev) => [...prev, ...page]);
      setArticlesExhausted(page.length < BIBLE_SEARCH_PAGE_SIZE);
      setIsLoadingMoreArticles(false);
    });
  }, [query, articles.length]);

  const loadMoreGuide = useCallback(() => {
    const requested = query.trim();
    setIsLoadingMoreGuide(true);
    void searchResearchGuideExtracts(requested, guide.length).then((result) => {
      if (activeQueryRef.current.trim() !== requested) return;
      const page = result.guide ?? [];
      setGuide((prev) => [...prev, ...page]);
      setGuideExhausted(page.length < BIBLE_SEARCH_PAGE_SIZE);
      setIsLoadingMoreGuide(false);
    });
  }, [query, guide.length]);

  // The two sources are paged independently and their ts_rank scores aren't
  // comparable across corpora, so the merged list simply alternates between
  // them — each keeps its own relevance order, and neither buries the other.
  const insightItems = useMemo(() => {
    const items: Array<{ kind: "article"; hit: InsightHit } | { kind: "guide"; hit: GuideHit }> = [];
    for (let i = 0; i < Math.max(articles.length, guide.length); i++) {
      if (i < articles.length) items.push({ kind: "article", hit: articles[i] });
      if (i < guide.length) items.push({ kind: "guide", hit: guide[i] });
    }
    return items;
  }, [articles, guide]);

  const insightExhausted = articlesExhausted && guideExhausted;
  const loadMoreInsight = useCallback(() => {
    if (!articlesExhausted) loadMoreArticles();
    if (!guideExhausted) loadMoreGuide();
  }, [articlesExhausted, guideExhausted, loadMoreArticles, loadMoreGuide]);

  if (query.trim().length < BIBLE_SEARCH_MIN_LENGTH) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <BookOpen className="size-6 text-muted-foreground/60" />
        <p className="text-[13.5px] text-muted-foreground">
          Digite ao menos {BIBLE_SEARCH_MIN_LENGTH} letras e pressione Enter para buscar na Bíblia, nas
          transcrições dos vídeos, no Perspicaz, no Guia de Pesquisa e na Biblioteca On-line.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex flex-1 flex-col gap-4 px-4 py-5 sm:px-6"
    >
      {jump && (
        <button
          type="button"
          onClick={() => onSelectVerse(jump.bookOrder, jump.chapter, jump.startVerse)}
          className="flex items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-primary/[0.12] px-4 py-3 text-left transition-colors hover:bg-primary/[0.18]"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground">
              ir direto para
            </span>
            <span className="truncate font-heading text-[15px] text-accent">
              {formatBibleReference(jump)}
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-accent" />
        </button>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as ResultsTab)}>
        {/* Sticky just under the reader's own sticky header (min-h-14 + the
            notch's safe-area inset), so switching source never needs a scroll
            back to the top. The wrapper carries the background — the list
            itself is a pill, and results would show around it — and bleeds
            into the container's side padding. */}
        <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6">
        {/* Four labelled tabs with counts are wider than a phone, and the list's
            default centring spilled the overflow off BOTH edges (the first tab
            was clipped with no way to reach it). Left-aligned and scrollable
            instead, tabs keep their natural width, and the active one is
            scrolled into view below. */}
        <TabsList ref={tabsListRef} className="w-full justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>[data-slot=tabs-trigger]]:flex-none [&>[data-slot=tabs-trigger]]:px-3">
          <TabsTrigger value="versiculos">
            <BookOpen className="size-3.5" />
            Versículos
            {verses.length > 0 && (
              <span className="ml-1 font-mono text-[10px] text-accent">
                {verses.length}
                {!versesExhausted && "+"}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="videos">
            <Film className="size-3.5" />
            Vídeos
            {videos.length > 0 && (
              <span className="ml-1 font-mono text-[10px] text-accent">
                {videos.length}
                {!videosExhausted && "+"}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="perspicaz">
            <BookMarked className="size-3.5" />
            Perspicaz
            {articles.length + guide.length > 0 && (
              <span className="ml-1 font-mono text-[10px] text-accent">
                {articles.length + guide.length}
                {(!articlesExhausted || !guideExhausted) && "+"}
              </span>
            )}
          </TabsTrigger>
          {/* "WOL", not "Biblioteca On-line": four tabs already fill a phone's width. */}
          <TabsTrigger value="biblioteca">
            <Globe className="size-3.5" />
            WOL
          </TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="versiculos" className="flex flex-col gap-2">
          {isLoading ? (
            <BibleVerseSearchSkeleton />
          ) : verses.length === 0 ? (
            <EmptyHint>Nenhum versículo encontrado para “{query.trim()}”.</EmptyHint>
          ) : (
            <>
              {verses.map((verse) => (
                <button
                  key={verse.id}
                  type="button"
                  onClick={() => onSelectVerse(verse.bookOrder, verse.chapter, verse.verse)}
                  className="flex flex-col gap-1 rounded-2xl bg-secondary px-4 py-3 text-left transition-colors hover:bg-surface-elevated"
                >
                  <span className="font-mono text-[10.5px] tracking-[0.04em] text-accent">
                    {verse.book} {verse.chapter}
                    {verse.verse !== null ? `:${verse.verse}` : ""}
                  </span>
                  <Highlighted
                    html={verse.headline}
                    className="whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/90"
                  />
                </button>
              ))}
              {!versesExhausted && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center"
                  isLoading={isLoadingMoreVerses}
                  onClick={loadMoreVerses}
                >
                  Carregar mais
                </Button>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="videos" className="flex flex-col gap-2">
          {isLoading ? (
            <BibleVideoSearchSkeleton />
          ) : videos.length === 0 ? (
            <EmptyHint>Nenhum vídeo encontrado para “{query.trim()}”.</EmptyHint>
          ) : (
            <>
              {videos.map((video) => (
                <button
                  key={video.videoId}
                  type="button"
                  onClick={() => onOpenDetail({ kind: "video", hit: video })}
                  className="flex items-start gap-3 rounded-2xl bg-secondary px-3 py-3 text-left transition-colors hover:bg-surface-elevated"
                >
                  <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-xl bg-black/50 sm:w-32">
                    {video.coverImage && (
                      // eslint-disable-next-line @next/next/no-img-element -- JW.org CDN host, not in next.config's image domains
                      <img
                        src={video.coverImage}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Play className="size-4 text-white/90 drop-shadow" />
                    </span>
                    {video.durationFormatted && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 font-mono text-[9px] text-white">
                        {video.durationFormatted}
                      </span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="line-clamp-2 text-[13.5px] font-medium text-foreground/90">{video.title}</span>
                    <Highlighted
                      html={video.headline}
                      className="line-clamp-3 text-[12.5px] leading-snug text-muted-foreground"
                    />
                  </span>
                </button>
              ))}
              {!videosExhausted && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center"
                  isLoading={isLoadingMoreVideos}
                  onClick={loadMoreVideos}
                >
                  Carregar mais
                </Button>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="perspicaz" className="flex flex-col gap-2">
          {isLoading ? (
            <BibleInsightSearchSkeleton />
          ) : insightItems.length === 0 ? (
            <EmptyHint>Nenhum resultado no Perspicaz ou no Guia de Pesquisa para “{query.trim()}”.</EmptyHint>
          ) : (
            <>
              {insightItems.map((item) => {
                const isArticle = item.kind === "article";
                const key = isArticle ? `a-${item.hit.id}` : `g-${item.hit.extractId}`;
                const title = isArticle ? item.hit.title : (item.hit.caption ?? item.hit.refTitle);
                const source = isArticle ? "Perspicaz" : "Guia de Pesquisa";
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      onOpenDetail(
                        item.kind === "article"
                          ? { kind: "article", hit: item.hit }
                          : { kind: "guide", hit: item.hit }
                      )
                    }
                    className="flex flex-col gap-1 rounded-2xl bg-secondary px-4 py-3 text-left transition-colors hover:bg-surface-elevated"
                  >
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" className="shrink-0">
                        {source}
                      </Badge>
                      {title && (
                        <span className="min-w-0 truncate font-mono text-[10.5px] tracking-[0.04em] text-accent">
                          {title}
                        </span>
                      )}
                    </span>
                    <Highlighted
                      html={item.hit.headline}
                      className="whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/90"
                    />
                  </button>
                );
              })}
              {!insightExhausted && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center"
                  isLoading={isLoadingMoreArticles || isLoadingMoreGuide}
                  onClick={loadMoreInsight}
                >
                  Carregar mais
                </Button>
              )}
            </>
          )}
        </TabsContent>

        {/* keepMounted: the list and its loaded pages survive a look at another tab. */}
        <TabsContent value="biblioteca" keepMounted>
          <WolSearchPanel
            query={query.trim()}
            active={tab === "biblioteca"}
            onOpen={(docId, title) => onOpenDetail({ kind: "wol", docId, title })}
          />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
