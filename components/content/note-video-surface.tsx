"use client";

import { motion } from "framer-motion";
import { InlineVideoCard } from "@/components/video/inline-video-card";
import { JwpubSidePanel } from "./jwpub-side-panel";

export interface NoteVideoTarget {
  videoId: string;
  title: string;
  videoUrl?: string;
  coverImage?: string;
  durationFormatted?: string;
  subtitlesUrl?: string;
}

interface NoteVideoSurfaceProps {
  open: boolean;
  video: NoteVideoTarget | null;
  isLoading: boolean;
  error?: string | null;
  onClose: () => void;
}

/**
 * Same side-panel-on-desktop/Vault-on-mobile shell as the Bible verse and
 * publication surfaces (note-reference-surface.tsx) — opened by clicking a
 * "@" video reference chip. Reuses InlineVideoCard (already used by the
 * Bible Study Panel) rather than a bespoke player.
 */
export function NoteVideoSurface({ open, video, isLoading, error, onClose }: NoteVideoSurfaceProps) {
  return (
    <JwpubSidePanel open={open} title={video?.title ?? "Vídeo"} onClose={onClose}>
      {isLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="size-1.5 rounded-full bg-accent"
          />
          carregando…
        </div>
      ) : video ? (
        <InlineVideoCard
          videoId={video.videoId}
          title={video.title}
          videoUrl={video.videoUrl}
          coverImage={video.coverImage}
          durationFormatted={video.durationFormatted}
          subtitlesUrl={video.subtitlesUrl}
        />
      ) : (
        <p className="text-[13.5px] text-muted-foreground">{error ?? "Vídeo não encontrado."}</p>
      )}
    </JwpubSidePanel>
  );
}
