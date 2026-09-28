"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  NotebookPen,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/components/ui/toaster";
import { createNoteFromVideo } from "@/app/(app)/convert-video-to-note";
import { getGlobalVideoById } from "@/app/(app)/global-video-actions";
import { parseVttToSegments } from "@/lib/video/video-utils";
import type { TranscriptSegment } from "@/lib/video/video-types";
import { useNotesStore } from "@/lib/store/notes-store";

/** How long the transcript stops auto-following after the person scrolls it by hand. */
const MANUAL_SCROLL_PAUSE_MS = 6000;

export interface InlineVideoCardProps {
  videoId: string;
  title: string;
  videoUrl?: string;
  coverImage?: string;
  durationFormatted?: string;
  subtitlesUrl?: string;
  snippet?: string;
}

export function InlineVideoCard({
  videoId,
  title: initialTitle,
  videoUrl: initialVideoUrl,
  coverImage: initialCoverImage,
  durationFormatted: initialDurationFormatted,
  subtitlesUrl: initialSubtitlesUrl,
  snippet,
}: InlineVideoCardProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [videoData, setVideoData] = useState({
    title: initialTitle,
    videoUrl: initialVideoUrl,
    coverImage: initialCoverImage,
    durationFormatted: initialDurationFormatted,
    subtitlesUrl: initialSubtitlesUrl,
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

  const [relevantStartTime, setRelevantStartTime] = useState<number | null>(null);
  const [relevantTimeFormatted, setRelevantTimeFormatted] = useState<string | null>(null);
  const hasSeekedRef = useRef(false);

  // Auto-fetch fresh video details from DB if missing props or default title
  useEffect(() => {
    if (videoId && (!videoData.videoUrl || !videoData.subtitlesUrl || videoData.title === "Vídeo JW")) {
      getGlobalVideoById(videoId).then((v) => {
        if (v) {
          setVideoData({
            title: v.title || initialTitle,
            videoUrl: v.video_url || undefined,
            coverImage: v.cover_image || undefined,
            durationFormatted: v.duration_formatted || undefined,
            subtitlesUrl: v.subtitles_url || undefined,
          });
        }
      });
    }
  }, [videoId, videoData.videoUrl, videoData.subtitlesUrl, videoData.title, initialTitle]);

  // Fetch VTT segments & find relevant timestamp if snippet is provided
  useEffect(() => {
    const subUrl = videoData.subtitlesUrl;
    if (subUrl && segments.length === 0) {
      queueMicrotask(() => setIsLoadingTranscript(true));
      fetch(subUrl)
        .then((r) => r.text())
        .then((vtt) => {
          const parsed = parseVttToSegments(vtt);
          setSegments(parsed);

          if (snippet) {
            const cleanTarget = snippet.toLowerCase();
            const words = cleanTarget.split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
            const matchedSeg = parsed.find((seg) => {
              const segText = seg.text.toLowerCase();
              return words.length > 0 && words.every((w) => segText.includes(w));
            });

            if (matchedSeg) {
              setRelevantStartTime(matchedSeg.startTime);
              setRelevantTimeFormatted(matchedSeg.startTimeFormatted);
            }
          }
        })
        .catch(() => null)
        .finally(() => setIsLoadingTranscript(false));
    }
  }, [videoData.subtitlesUrl, snippet, segments.length]);

  const handlePlay = () => {
    setIsPlaying(true);
    if (!hasSeekedRef.current && relevantStartTime !== null && videoRef.current) {
      hasSeekedRef.current = true;
      videoRef.current.currentTime = relevantStartTime;
    }
  };

  // `relevantStartTime` resolves whenever the VTT fetch above finishes — a
  // network request racing against the click that opens this card. If the
  // person presses the native player's play button before that fetch lands,
  // `handlePlay` above fires with `relevantStartTime` still `null` and never
  // gets a second chance (nothing re-triggers `onPlay`), so the video plays
  // from 0:00 despite having been opened specifically to see this excerpt.
  // Seeking here too, the moment the timestamp becomes known, closes that
  // window — `readyState` must be at least HAVE_METADATA for `currentTime`
  // to take, so pending metadata (the more common case, since the video's
  // own load kicks off no earlier than the transcript fetch) is caught by
  // `onLoadedMetadata` below instead.
  useEffect(() => {
    if (relevantStartTime === null || hasSeekedRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 1) return;
    hasSeekedRef.current = true;
    video.currentTime = relevantStartTime;
  }, [relevantStartTime]);

  const handleLoadedMetadata = () => {
    if (hasSeekedRef.current || relevantStartTime === null || !videoRef.current) return;
    hasSeekedRef.current = true;
    videoRef.current.currentTime = relevantStartTime;
  };

  const handleSeekTo = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      void videoRef.current.play();
      setIsPlaying(true);
    }
  };

  // The line the video is on right now: the last one that has already started,
  // not "within 2.5s of its start" — a segment can run much longer than that,
  // and a gap between segments used to leave nothing highlighted at all.
  const activeIndex = useMemo(() => {
    if (segments.length === 0) return -1;
    // Before the first play, `currentTime` may still be 0 even though the card
    // was opened for a specific excerpt (the seek only lands once the video
    // has metadata) — aim at that excerpt instead of the top of the video.
    const time = currentTime > 0 ? currentTime : (relevantStartTime ?? 0);
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].startTime <= time + 0.25) return i;
    }
    return 0;
  }, [segments, currentTime, relevantStartTime]);

  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLButtonElement>(null);
  // Our own scrolling fires `scroll` events too, so it has to be told apart
  // from the person dragging the list — otherwise auto-follow would read its
  // own scroll as manual input and immediately switch itself off.
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastManualScrollAt = useRef(0);

  const scrollActiveSegmentIntoView = useCallback((behavior: ScrollBehavior) => {
    const container = transcriptScrollRef.current;
    const element = activeSegmentRef.current;
    if (!container || !element) return;

    // Deliberately NOT `scrollIntoView`: that scrolls every scrollable
    // ancestor, so it would also yank the side panel and the chapter text
    // behind it. Setting this one container's scrollTop keeps the movement
    // where it belongs.
    const top = element.offsetTop - container.clientHeight / 2 + element.clientHeight / 2;

    programmaticScrollRef.current = true;
    if (programmaticScrollTimer.current) clearTimeout(programmaticScrollTimer.current);
    programmaticScrollTimer.current = setTimeout(
      () => {
        programmaticScrollRef.current = false;
      },
      behavior === "smooth" ? 600 : 80
    );

    container.scrollTo({ top: Math.max(0, top), behavior });
  }, []);

  useEffect(() => () => {
    if (programmaticScrollTimer.current) clearTimeout(programmaticScrollTimer.current);
  }, []);

  // Opening the transcript lands on the highlighted line rather than at 00:00.
  // Instant, not smooth: the list is expanding at the same time, and animating
  // both at once reads as a stutter.
  useEffect(() => {
    if (!showTranscript || activeIndex < 0) return;
    scrollActiveSegmentIntoView("auto");
    // `segments.length` covers the transcript finishing its fetch while the
    // list is already open; `activeIndex` is intentionally left out so this
    // doesn't re-fire on every tick of playback (that's the effect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTranscript, segments.length, scrollActiveSegmentIntoView]);

  // Keeps the highlighted line in view while the video plays, unless the
  // person has just scrolled the list themselves.
  useEffect(() => {
    if (!showTranscript || !isPlaying || activeIndex < 0) return;
    if (Date.now() - lastManualScrollAt.current < MANUAL_SCROLL_PAUSE_MS) return;
    scrollActiveSegmentIntoView("smooth");
  }, [activeIndex, showTranscript, isPlaying, scrollActiveSegmentIntoView]);

  const handleConvertToNote = async () => {
    setIsConverting(true);
    try {
      const res = await createNoteFromVideo(videoId);
      if (res.ok && res.noteId) {
        if (res.note) {
          useNotesStore.getState().upsertNoteFromDb(res.note);
        }
        if (res.alreadyExisted) {
          notify.info("Nota já existente para este vídeo. Redirecionando…");
        } else {
          notify.success("Nota criada a partir da transcrição!");
        }
        router.push(`/notes/${res.noteId}`);
      } else {
        notify.error(res.error ?? "Não foi possível criar a nota.");
      }
    } catch {
      notify.error("Ocorreu um erro ao criar a nota.");
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div className="my-2.5 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm transition-all hover:border-border">
      {/* Header Info Bar — a deliberate two-row layout (title on top, time badge
          + convert action below) instead of one row that wraps unpredictably;
          that used to leave a lopsided gap once the button dropped to its own
          line at the card's narrower mobile width. */}
      <div className="flex flex-col gap-1.5 border-b border-border/60 bg-secondary/30 px-3.5 py-2.5 text-xs">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span className="truncate font-medium text-foreground/90">{videoData.title}</span>
        </div>

        <div className={cn("flex items-center gap-2", relevantTimeFormatted ? "justify-between" : "justify-end")}>
          {relevantTimeFormatted && (
            <Badge className="h-auto shrink-0 bg-accent/20 text-accent border-accent/40 px-2 py-0.5 font-mono text-[10px]">
              🎯 Início em {relevantTimeFormatted}
            </Badge>
          )}

          <Button
            variant="outline"
            size="sm"
            isLoading={isConverting}
            leftIcon={<NotebookPen className="size-3 text-accent" />}
            onClick={() => void handleConvertToNote()}
            className="h-7 shrink-0 rounded-full px-2.5 text-[11px]"
          >
            Transformar em nota
          </Button>
        </div>
      </div>

      {/* Video Player Box */}
      <div className="relative aspect-video w-full bg-black/90">
        {videoData.videoUrl ? (
          <video
            ref={videoRef}
            src={videoData.videoUrl}
            poster={videoData.coverImage}
            controls
            playsInline
            onPlay={handlePlay}
            onLoadedMetadata={handleLoadedMetadata}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
            <Sparkles className="size-6 text-accent animate-pulse" />
            <span>Vídeo em sincronização...</span>
          </div>
        )}

        {videoData.durationFormatted && !isPlaying && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white backdrop-blur-xs">
            {videoData.durationFormatted}
          </span>
        )}
      </div>

      {/* Expandable Transcript Toggle Footer */}
      <div className="flex flex-col border-t border-border/60 bg-secondary/20">
        <button
          type="button"
          onClick={() => setShowTranscript((v) => !v)}
          className="flex w-full items-center justify-between px-3.5 py-2 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
        >
          <div className="flex items-center gap-1.5">
            <FileText className="size-3.5 text-accent" />
            <span>Transcrição interativa com tempo</span>
          </div>
          {showTranscript ? (
            <ChevronUp className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          )}
        </button>

        {/* Expandable Transcript Content List */}
        <AnimatePresence>
          {showTranscript && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-border/40 bg-background/50"
            >
              {/* `relative` makes this the offsetParent the auto-scroll above
                  measures each line against. */}
              <div
                ref={transcriptScrollRef}
                onScroll={() => {
                  if (programmaticScrollRef.current) return;
                  lastManualScrollAt.current = Date.now();
                }}
                className="relative max-h-60 overflow-y-auto p-2 scrollbar-none"
              >
                {isLoadingTranscript ? (
                  <p className="p-3 text-center text-[11.5px] text-muted-foreground">
                    Carregando transcrição...
                  </p>
                ) : segments.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {segments.map((segment, index) => {
                      const isActive = index === activeIndex;
                      return (
                        <button
                          key={`${segment.startTime}-${segment.text.slice(0, 15)}`}
                          ref={isActive ? activeSegmentRef : undefined}
                          type="button"
                          onClick={() => handleSeekTo(segment.startTime)}
                          className={cn(
                            "flex items-start gap-2.5 rounded-lg p-2 text-left text-[12px] transition-colors",
                            isActive
                              ? "bg-primary/20 text-accent font-medium"
                              : "text-foreground/80 hover:bg-secondary"
                          )}
                        >
                          <span className="mt-0.5 shrink-0 font-mono text-[10.5px] text-accent">
                            {segment.startTimeFormatted}
                          </span>
                          <span className="leading-snug">{segment.text}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="p-3 text-center text-[11.5px] text-muted-foreground">
                    Nenhuma transcrição disponível para este vídeo.
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
