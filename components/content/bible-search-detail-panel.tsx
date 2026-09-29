"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { InlineVideoCard } from "@/components/video/inline-video-card";
import { sanitizeChapterHtml } from "@/lib/jwpub/sanitize";
import {
  getResearchGuideExtractHtml,
  type GuideHit,
  type InsightHit,
  type VideoHit,
} from "@/app/(app)/bible-search-actions";
import { getGlobalPublicationChapterContent } from "@/app/(app)/global-publications-actions";
import { getWolArticle, type WolArticle } from "@/app/(app)/wol-actions";
import { wolDocPath } from "@/lib/wol/parse";
import { JwpubSidePanel } from "./jwpub-side-panel";

/** What a search result opens in the side panel. */
export type BibleSearchDetail =
  | { kind: "video"; hit: VideoHit }
  | { kind: "article"; hit: InsightHit }
  | { kind: "guide"; hit: GuideHit }
  | { kind: "wol"; docId: number; title: string };

function detailKey(detail: BibleSearchDetail): string {
  switch (detail.kind) {
    case "video":
      return `video-${detail.hit.videoId}`;
    case "article":
      return `article-${detail.hit.id}`;
    case "guide":
      return `guide-${detail.hit.extractId}`;
    case "wol":
      return `wol-${detail.docId}`;
  }
}

const DETAIL_TITLES: Record<BibleSearchDetail["kind"], string> = {
  video: "Vídeo",
  article: "Perspicaz",
  guide: "Guia de Pesquisa",
  wol: "Biblioteca On-line",
};

const PROSE_CLASS =
  "text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-xl";

interface BibleSearchDetailPanelProps {
  detail: BibleSearchDetail | null;
  onClose: () => void;
  /** A Bible reference inside a result — leaves the search for the reading screen. */
  onSelectVerse: (bookOrder: number, chapter: number, verse: number | null) => void;
}

/**
 * Where the Bible search's results open. Videos, Perspicaz articles, Guia
 * excerpts and WOL documents used to expand inline inside the results list,
 * which squeezed them into a phone-width card and pushed the rest of the list
 * around; now they go in the shared `JwpubSidePanel` — a side panel beside the
 * results on desktop, a `Vault` on mobile — so the list stays put and the
 * content gets the room to be read.
 *
 * Rendered by `BibleReader` as a flex SIBLING of the results column (the panel
 * animates its own width to push content, which only works inside a flex row).
 */
export function BibleSearchDetailPanel({ detail, onClose, onSelectVerse }: BibleSearchDetailPanelProps) {
  // Keeps rendering the last detail while the panel's exit animation runs —
  // with `detail` already null the content would vanish first, leaving an empty
  // sliding-out shell.
  const [shown, setShown] = useState(detail);
  if (detail && detail !== shown) setShown(detail);

  return (
    <JwpubSidePanel open={detail !== null} title={shown ? DETAIL_TITLES[shown.kind] : ""} onClose={onClose} width={440}>
      {shown && <DetailBody key={detailKey(shown)} detail={shown} onSelectVerse={onSelectVerse} />}
    </JwpubSidePanel>
  );
}

function DetailBody({
  detail,
  onSelectVerse,
}: {
  detail: BibleSearchDetail;
  onSelectVerse: BibleSearchDetailPanelProps["onSelectVerse"];
}) {
  switch (detail.kind) {
    case "video": {
      const video = detail.hit;
      return (
        <InlineVideoCard
          videoId={video.videoId}
          title={video.title}
          videoUrl={video.videoUrl ?? undefined}
          coverImage={video.coverImage ?? undefined}
          durationFormatted={video.durationFormatted ?? undefined}
          subtitlesUrl={video.subtitlesUrl ?? undefined}
          // Hands the matched excerpt to the player, which finds the subtitle
          // line it came from and starts there instead of at 00:00 — the whole
          // point of searching a transcript rather than a title.
          snippet={video.snippet}
        />
      );
    }
    case "article":
      return <ArticleDetail hit={detail.hit} />;
    case "guide":
      return <GuideDetail hit={detail.hit} onSelectVerse={onSelectVerse} />;
    case "wol":
      return <WolDetail docId={detail.docId} title={detail.title} onSelectVerse={onSelectVerse} />;
  }
}

function Loading() {
  return <span className="text-[12px] text-muted-foreground">carregando…</span>;
}

function ArticleDetail({ hit }: { hit: InsightHit }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getGlobalPublicationChapterContent(hit.publicationId, hit.documentId).then((result) => {
      if (cancelled) return;
      setHtml(result.html ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [hit.publicationId, hit.documentId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="font-heading text-[15px]">{hit.title}</span>
        <span className="text-[11.5px] text-muted-foreground">{hit.publicationTitle}</span>
      </div>
      {loading ? (
        <Loading />
      ) : html ? (
        <div className={PROSE_CLASS} dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(html) }} />
      ) : (
        <span className="text-[12px] text-muted-foreground">Não foi possível carregar este artigo.</span>
      )}
    </div>
  );
}

function GuideDetail({
  hit,
  onSelectVerse,
}: {
  hit: GuideHit;
  onSelectVerse: BibleSearchDetailPanelProps["onSelectVerse"];
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getResearchGuideExtractHtml(hit.extractId).then((result) => {
      if (cancelled) return;
      setHtml(result.html ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [hit.extractId]);

  const title = hit.caption ?? hit.refTitle;
  const verse = hit.verse;

  return (
    <div className="flex flex-col gap-3">
      {title && <span className="font-heading text-[15px]">{title}</span>}
      {loading ? (
        <Loading />
      ) : html ? (
        <div className={PROSE_CLASS} dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(html) }} />
      ) : (
        <span className="text-[12px] text-muted-foreground">Não foi possível carregar este trecho.</span>
      )}
      {verse && (
        <button
          type="button"
          onClick={() => onSelectVerse(verse.bookOrder, verse.chapter, verse.verse)}
          className="flex items-center gap-1.5 self-start text-[12px] text-accent hover:underline"
        >
          Ir para {verse.book} {verse.chapter}:{verse.verse}
          <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}

interface OpenDoc {
  /** The page's path under /pt/wol/ — see isWolPath in lib/wol/parse.ts. */
  path: string;
  title: string;
  article: WolArticle | null;
  loading: boolean;
}

/**
 * A WOL document, read in place. It behaves like a small browser: a link to
 * another WOL document opens on top of this one ("Voltar" pops back), and a
 * Bible reference jumps to the app's own reader.
 */
function WolDetail({
  docId,
  title,
  onSelectVerse,
}: {
  docId: number;
  title: string;
  onSelectVerse: BibleSearchDetailPanelProps["onSelectVerse"];
}) {
  const [stack, setStack] = useState<OpenDoc[]>(() => [
    { path: wolDocPath(docId), title, article: null, loading: true },
  ]);

  const load = useCallback((path: string) => {
    void getWolArticle(path).then((result) => {
      if (result.error) notify.error("Não foi possível abrir", result.error);
      setStack((prev) =>
        prev.map((doc) =>
          doc.path === path && doc.loading
            ? { path, title: result.article?.title ?? doc.title, article: result.article ?? null, loading: false }
            : doc
        )
      );
    });
  }, []);

  useEffect(() => {
    load(wolDocPath(docId));
  }, [docId, load]);

  const openLinked = useCallback(
    (path: string, linkTitle: string) => {
      setStack((prev) => [...prev, { path, title: linkTitle, article: null, loading: true }]);
      load(path);
    },
    [load]
  );

  const current = stack[stack.length - 1];

  function handleArticleClick(event: React.MouseEvent<HTMLElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-wol-path], [data-wol-verse]");
    if (!target) return;

    const linkedPath = target.getAttribute("data-wol-path");
    if (linkedPath) {
      openLinked(linkedPath, target.textContent?.trim() || "Documento");
      return;
    }

    const [bookOrder, chapter, verse] = (target.getAttribute("data-wol-verse") ?? "").split(":").map(Number);
    if (bookOrder && chapter) onSelectVerse(bookOrder, chapter, verse || null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        {stack.length > 1 ? (
          <Button variant="ghost" size="sm" onClick={() => setStack((prev) => prev.slice(0, -1))}>
            <ArrowLeft className="size-3.5" />
            Voltar
          </Button>
        ) : (
          <span />
        )}
        {current.article && (
          <a
            href={current.article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-accent"
          >
            Abrir no WOL
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>

      {current.loading ? (
        <div className="flex flex-col gap-2">
          <span className="font-heading text-[15px]">{current.title}</span>
          <Loading />
        </div>
      ) : !current.article ? (
        <span className="text-[12px] text-muted-foreground">Não foi possível abrir este documento.</span>
      ) : (
        <article
          onClick={handleArticleClick}
          className={cn(
            PROSE_CLASS,
            "[&_h1]:mb-3 [&_h1]:font-heading [&_h1]:text-[17px] [&_h2]:my-3 [&_h2]:font-heading [&_h2]:text-[15px]",
            // Only links the rewrite turned into something clickable look like links.
            "[&_a[data-wol-path]]:cursor-pointer [&_a[data-wol-path]]:text-accent [&_a[data-wol-path]]:hover:underline",
            "[&_a[data-wol-verse]]:cursor-pointer [&_a[data-wol-verse]]:text-accent [&_a[data-wol-verse]]:hover:underline",
            // The page-number markers WOL emits as empty spans.
            "[&_.pageNum]:hidden"
          )}
        >
          <div dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(current.article.html) }} />
          {current.article.truncated && (
            <p className="text-[12px] text-muted-foreground">
              Documento muito longo — mostrando só o começo.{" "}
              <a
                href={current.article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Ler tudo no WOL
              </a>
            </p>
          )}
        </article>
      )}
    </div>
  );
}
