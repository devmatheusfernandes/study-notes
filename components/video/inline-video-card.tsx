"use client";

import { useEffect, useRef, useState } from "react";
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

export interface InlineVideoCardProps {
  videoId: string;
  title: string;
  videoUrl?: string;
  coverImage?: string;
  durationFormatted?: string;
  subtitlesUrl?: string;
}

export function InlineVideoCard({
  videoId,
  title: initialTitle,
  videoUrl: initialVideoUrl,
  coverImage: initialCoverImage,
  durationFormatted: initialDurationFormatted,
  subtitlesUrl: initialSubtitlesUrl,
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

  // Fetch VTT segments when user opens transcript for the first time
  useEffect(() => {
    const subUrl = videoData.subtitlesUrl;
    if (showTranscript && subUrl && segments.length === 0) {
      queueMicrotask(() => setIsLoadingTranscript(true));
      fetch(subUrl)
        .then((r) => r.text())
        .then((vtt) => {
          setSegments(parseVttToSegments(vtt));
        })
        .catch((err) => console.error("Erro ao carregar legenda:", err))
        .finally(() => setIsLoadingTranscript(false));
    }
  }, [showTranscript, videoData.subtitlesUrl, segments.length]);

  const handleSeekTo = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      void videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleConvertToNote = async () => {
    setIsConverting(true);
    try {
      const res = await createNoteFromVideo(videoId);
      if (res.ok && res.noteId) {
        notify.success("Nota criada a partir da transcrição!");
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
      {/* Header Info Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-secondary/30 px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className="h-auto px-2 py-0.5 font-mono text-[9.5px] uppercase">
            Vídeo JW
          </Badge>
          <span className="truncate font-medium text-foreground/90">{videoData.title}</span>
        </div>

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

      {/* Video Player Box */}
      <div className="relative aspect-video w-full bg-black/90">
        {videoData.videoUrl ? (
          <video
            ref={videoRef}
            src={videoData.videoUrl}
            poster={videoData.coverImage}
            controls
            playsInline
            onPlay={() => setIsPlaying(true)}
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
              <div className="max-h-60 overflow-y-auto p-2 scrollbar-none">
                {isLoadingTranscript ? (
                  <p className="p-3 text-center text-[11.5px] text-muted-foreground">
                    Carregando transcrição...
                  </p>
                ) : segments.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {segments.map((segment) => {
                      const isActive = Math.abs(segment.startTime - currentTime) < 2.5;
                      return (
                        <button
                          key={`${segment.startTime}-${segment.text.slice(0, 15)}`}
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
