"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Widest a page gets at 100% - a sheet of paper, not a wall. */
const MAX_PAGE_CSS_WIDTH = 896;

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
  /** 1 fits the page to the screen; above that the pages grow and the view scrolls sideways. */
  zoom: number;
  onZoomChange: (zoom: number) => void;
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
export function PdfPages({ url, initialPage, strokes, ink, zoom, onZoomChange, onError }: PdfPagesProps) {
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

  // Zoom: a zoomed page is wider than the screen, so the pages live in a column
  // whose width is `zoom` times the fitted one, inside a sideways-scrolling frame.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => setViewWidth(scroller.clientWidth));
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [doc]);

  const pad = viewWidth >= 640 ? 24 : 8;
  const fittedWidth = Math.min(Math.max(viewWidth - pad * 2, 0), MAX_PAGE_CSS_WIDTH);
  const columnWidth = fittedWidth * zoom;

  // Zooming keeps whatever was in the middle of the screen in the middle.
  const previousZoom = useRef(zoom);
  useLayoutEffect(() => {
    const before = previousZoom.current;
    previousZoom.current = zoom;
    if (before === zoom) return;
    const ratio = zoom / before;
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollLeft = (scroller.scrollLeft + scroller.clientWidth / 2) * ratio - scroller.clientWidth / 2;
    const half = window.innerHeight / 2;
    window.scrollTo(0, (window.scrollY + half) * ratio - half);
  }, [zoom]);

  // Pinch with two fingers, or ctrl + wheel (also what a laptop trackpad pinch sends).
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  });
  const onZoomRef = useRef(onZoomChange);
  useEffect(() => {
    onZoomRef.current = onZoomChange;
  });
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let startDistance = 0;
    let startZoom = 1;
    const distance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length === 2) {
        startDistance = distance(event.touches);
        startZoom = zoomRef.current;
      }
    }
    function onTouchMove(event: TouchEvent) {
      if (event.touches.length !== 2 || startDistance === 0) return;
      event.preventDefault();
      onZoomRef.current(clampZoom(startZoom * (distance(event.touches) / startDistance)));
    }
    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) startDistance = 0;
    }
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      onZoomRef.current(clampZoom(zoomRef.current * Math.exp(-event.deltaY * 0.01)));
    }

    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchEnd);
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      scroller.removeEventListener("wheel", onWheel);
    };
  }, [doc]);

  if (!doc) return <PdfSkeleton progress={progress} />;

  return (
    // The browser's own pinch would zoom the whole app; this frame handles it instead.
    <div ref={scrollerRef} className="w-full overflow-x-auto overscroll-x-contain" style={{ touchAction: "pan-x pan-y" }}>
      <div
        className="flex flex-col gap-4 py-4"
        style={{ width: columnWidth > 0 ? columnWidth + pad * 2 : undefined, paddingInline: pad, marginInline: "auto" }}
      >
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
    // The first measurement lands at once; later ones (pinching, zoom buttons) wait for the
    // gesture to settle so the page isn't re-rasterised on every frame - meanwhile the
    // existing pixels are just stretched.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let measured = false;
    const observer = new ResizeObserver(() => {
      const next = Math.round(host.getBoundingClientRect().width);
      if (!measured) {
        measured = true;
        setWidth(next);
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setWidth(next), 160);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
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
      // Runs when the page comes back into range, by which point the canvas is blank.
      return () => setRendered(false);
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

        // Drawn off screen and copied over in one go: resizing the visible canvas
        // clears it, which made the page flash to its skeleton on every zoom.
        const offscreen = document.createElement("canvas");
        offscreen.width = Math.floor(viewport.width);
        offscreen.height = Math.floor(viewport.height);
        task = page.render({ canvas: offscreen, viewport });
        await task.promise;
        if (cancelled) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.getContext("2d")?.drawImage(offscreen, 0, 0);
        setRendered(true);
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
    };
  }, [doc, pageNumber, near, width]);

  return (
    <div
      ref={hostRef}
      data-pdf-page={pageNumber}
      style={{ aspectRatio: aspect }}
      // Square corners, like a printed sheet. Paper is white once drawn; until then it
      // follows the theme so the skeleton doesn't glare in dark mode.
      className={cn(
        "relative w-full overflow-hidden shadow-[0_8px_28px_var(--shadow)] ring-1 ring-border",
        rendered ? "bg-white" : "bg-card"
      )}
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
    <div className="absolute inset-0 flex flex-col gap-3 bg-card p-[8%]" aria-hidden>
      <Skeleton className="h-5 w-2/5 rounded-md bg-foreground/10" />
      <div className="flex flex-col gap-2 pt-4">
        {[96, 100, 92, 98, 70, 100, 94, 88, 100, 60].map((w, i) => (
          <Skeleton key={i} className="h-2.5 rounded-sm bg-foreground/[0.07]" style={{ width: `${w}%` }} />
        ))}
      </div>
      <Skeleton className="mt-3 h-[22%] w-full rounded-sm bg-foreground/[0.07]" />
      <div className="flex flex-col gap-2 pt-2">
        {[100, 90, 97, 64].map((w, i) => (
          <Skeleton key={i} className="h-2.5 rounded-sm bg-foreground/[0.07]" style={{ width: `${w}%` }} />
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
          {progress === null ? null : `${Math.round(progress * 100)}%`}
        </span>
      </div>
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{ aspectRatio: 1 / 1.4142 }}
          className="relative w-full overflow-hidden bg-card shadow-[0_8px_28px_var(--shadow)] ring-1 ring-border"
        >
          <PageShimmer />
        </div>
      ))}
    </div>
  );
}
