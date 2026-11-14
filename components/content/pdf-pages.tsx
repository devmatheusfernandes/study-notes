"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { DrawingCanvas } from "@/components/content/drawing-canvas";
import type { DrawTool, Stroke } from "@/lib/drawing/strokes";

/** The page is white paper whatever the app theme, so ink is always shown the way it reads on a light page. */
const PAPER_APPEARANCE = "light" as const;

/** A canvas bigger than this (device pixels) is refused by some mobile browsers, which then paint a blank page. */
const MAX_PAGE_PIXELS = 8_000_000;

export interface PdfInk {
  active: boolean;
  tool: DrawTool;
  color: string;
  size: number;
  penOnly: boolean;
  onPenDetected: () => void;
  onCommitStroke: (stroke: Stroke) => void;
  onEraseStrokes: (ids: string[], startsGesture: boolean) => void;
}

interface PdfPagesProps {
  url: string;
  initialPage?: number;
  strokes: Stroke[];
  ink: PdfInk;
  /** Fired when the document can't be opened — the reader shows its own retry/"open in new tab" fallback. */
  onError: (message: string) => void;
}

/**
 * Renders a PDF with pdf.js into canvases instead of handing the URL to an
 * `<iframe>`. Android Chrome (and iOS Safari for long documents) has no inline
 * PDF viewer — the frame comes up as "este conteúdo está bloqueado" — so
 * relying on the browser's own viewer only ever worked on desktop. Drawing the
 * pages ourselves also gives each one a surface to write on.
 */
export function PdfPages({ url, initialPage, strokes, ink, onError }: PdfPagesProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    let task: { destroy: () => Promise<void> } | null = null;

    (async () => {
      try {
        // Legacy build: the same renderer transpiled for older WebViews/Chrome
        // versions, which is what an aging tablet is likely to be running.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        // Whole file up front, no range requests: the signed URL lives 60
        // seconds, and a range request for page 40 minutes later would be
        // refused. PDFs here are capped at 15 MB, so one download is cheap.
        const loading = pdfjs.getDocument({
          url,
          disableRange: true,
          disableStream: true,
          // The CSP has no 'unsafe-eval' in production; skip pdf.js's eval-based font fast path instead of tripping it.
          isEvalSupported: false,
        });
        task = loading;
        loading.onProgress = ({ loaded: got, total }: { loaded: number; total: number }) => {
          if (!cancelled && total > 0) setProgress(Math.min(1, got / total));
        };
        loaded = await loading.promise;
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        setDoc(loaded);
      } catch (error) {
        if (!cancelled) onError(error instanceof Error ? error.message : "Não foi possível abrir o PDF.");
      }
    })();

    return () => {
      cancelled = true;
      void (loaded?.destroy() ?? task?.destroy());
    };
    // `onError` is a stable callback owned by the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (!doc) return <PdfSkeleton progress={progress} />;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-2 py-4 sm:px-6">
      {Array.from({ length: doc.numPages }, (_, index) => (
        <PdfPage
          key={index + 1}
          doc={doc}
          pageNumber={index + 1}
          scrollTo={initialPage === index + 1}
          strokes={strokes}
          ink={ink}
        />
      ))}
    </div>
  );
}

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scrollTo: boolean;
  strokes: Stroke[];
  ink: PdfInk;
}

const PdfPage = memo(function PdfPage({ doc, pageNumber, scrollTo, strokes: allStrokes, ink }: PdfPageProps) {
  // This page's ink, kept referentially stable while it is unchanged so that
  // writing on page 3 doesn't make every other visible page repaint its layer.
  const onPage = useMemo(() => allStrokes.filter((s) => (s.page ?? 1) === pageNumber), [allStrokes, pageNumber]);
  const [strokes, setStrokes] = useState(onPage);
  if (strokes !== onPage && (strokes.length !== onPage.length || strokes.some((s, i) => s !== onPage[i]))) {
    setStrokes(onPage);
  }

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Until a page has been measured, assume it's shaped like a sheet of A4 so
  // the document doesn't jump around as pages are discovered.
  const [aspect, setAspect] = useState(1 / 1.4142);
  const [near, setNear] = useState(pageNumber <= 2);
  const [width, setWidth] = useState(0);
  const [rendered, setRendered] = useState(false);

  // Only pages near the viewport hold a canvas: a 200-page PDF at full
  // resolution would be gigabytes of pixels.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      rootMargin: "1500px 0px",
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => setWidth(Math.round(host.getBoundingClientRect().width)));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (scrollTo) hostRef.current?.scrollIntoView({ block: "start" });
  }, [scrollTo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;

    if (!near) {
      // Give the pixels back; the page re-renders when it scrolls into range.
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

    let cancelled = false;
    let task: RenderTask | null = null;

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        setAspect(base.width / base.height);

        const cssScale = width / base.width;
        const area = width * (width * (base.height / base.width));
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PAGE_PIXELS / area)));
        const viewport = page.getViewport({ scale: cssScale * dpr });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        task = page.render({ canvas, viewport });
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch (error) {
        // A cancelled render (the page scrolled away, or the width changed
        // mid-render) rejects on purpose; anything else leaves the skeleton up.
        if (!(error instanceof Error && error.name === "RenderingCancelledException")) {
          console.error(`PDF page ${pageNumber}`, error);
        }
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      // Resizing (or leaving the viewport) wipes the canvas, so the skeleton
      // has to come back until the next render lands.
      setRendered(false);
    };
  }, [doc, pageNumber, near, width]);

  return (
    <div
      ref={hostRef}
      data-pdf-page={pageNumber}
      style={{ aspectRatio: aspect }}
      className="relative w-full overflow-hidden rounded-lg bg-white shadow-[0_8px_28px_var(--shadow)] ring-1 ring-border"
    >
      <canvas ref={canvasRef} className={cn("absolute inset-0 size-full transition-opacity duration-300", rendered ? "opacity-100" : "opacity-0")} />

      {!rendered && <PageShimmer />}

      {near && (
        <DrawingCanvas
          strokes={strokes}
          tool={ink.tool}
          color={ink.color}
          size={ink.size}
          active={ink.active}
          penOnly={ink.penOnly}
          appearance={PAPER_APPEARANCE}
          onPenDetected={ink.onPenDetected}
          onCommitStroke={(stroke) => ink.onCommitStroke({ ...stroke, page: pageNumber })}
          onEraseStrokes={ink.onEraseStrokes}
        />
      )}

      <span className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-black/45 px-2 py-0.5 font-mono text-[10px] text-white">
        {pageNumber}
      </span>
    </div>
  );
});

/** Placeholder lines standing in for a page's text until its pixels arrive. */
function PageShimmer() {
  return (
    <div className="absolute inset-0 flex flex-col gap-3 bg-white p-[8%]" aria-hidden>
      <Skeleton className="h-5 w-2/5 bg-black/10" />
      <div className="flex flex-col gap-2 pt-4">
        {[96, 100, 92, 98, 70, 100, 94, 88, 100, 60].map((w, i) => (
          <Skeleton key={i} className="h-2.5 bg-black/[0.07]" style={{ width: `${w}%` }} />
        ))}
      </div>
      <Skeleton className="mt-3 h-[22%] w-full bg-black/[0.07]" />
      <div className="flex flex-col gap-2 pt-2">
        {[100, 90, 97, 64].map((w, i) => (
          <Skeleton key={i} className="h-2.5 bg-black/[0.07]" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Shown while the file downloads and pdf.js parses it: page-shaped cards, so the layout that follows is already in place. */
export function PdfSkeleton({ progress }: { progress: number | null }) {
  return (
    <div role="status" aria-label="Carregando PDF" className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-2 py-4 sm:px-6">
      <div className="flex items-center gap-3 px-1">
        <Progress value={progress === null ? null : Math.round(progress * 100)} className="h-1.5 flex-1" />
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {progress === null ? "Abrindo…" : `${Math.round(progress * 100)}%`}
        </span>
      </div>
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{ aspectRatio: 1 / 1.4142 }}
          className="relative w-full overflow-hidden rounded-lg bg-white shadow-[0_8px_28px_var(--shadow)] ring-1 ring-border"
        >
          <PageShimmer />
        </div>
      ))}
    </div>
  );
}
