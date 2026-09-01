"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { FileText, NotebookPen, Sparkles, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatSource } from "@/lib/store/chat-store";
import { InlineVideoCard } from "@/components/video/inline-video-card";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
  isStreaming?: boolean;
}

function extractExactPhrase(snippet?: string): string | undefined {
  if (!snippet) return undefined;
  const clean = snippet.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  // Keep every word, including one-letter ones ("a", "e", "o", "é"...) — those
  // are essential connective words in Portuguese, and dropping them broke the
  // "verbatim substring" assumption the reader's highlighter depends on
  // (e.g. "devoção a Deus" would become "devoção Deus", which never matches).
  const words = clean.split(" ").filter(Boolean);
  if (words.length === 0) return undefined;
  return words.slice(0, 6).join(" ");
}

function sourceHref(source: ChatSource): string {
  if (source.type === "video" || source.videoId) {
    if (source.videoId) {
      return `https://www.jw.org/finder?lank=${source.videoId}&wtlocale=P`;
    }
    if (source.videoUrl) return source.videoUrl;
    return "https://www.jw.org";
  }

  if (!source.noteId) return "/notes";

  const params = new URLSearchParams();

  // documentId is a stable, unique numeric id per chapter — prefer it over
  // the title. Some JW books have a chapter whose title matches the book's
  // own cover title except for capitalization (confirmed in "Organizados
  // para Fazer a Vontade de Jeová": chapter 0 is the cover, chapter 4 is a
  // real chapter with the same title in lowercase) — the reader's
  // case-insensitive title lookup can't tell those apart, but documentId can.
  if (source.documentId !== undefined) {
    params.set("doc", String(source.documentId));
  } else if (source.chapterTitle) {
    params.set("chapter", source.chapterTitle);
  }

  const phrase = extractExactPhrase(source.snippet);
  if (phrase) {
    params.set("text", phrase);
  }

  const qs = params.toString();
  return qs ? `/notes/${source.noteId}?${qs}` : `/notes/${source.noteId}`;
}

function sourceIcon(type: string) {
  if (type === "jwpub") return FileText;
  if (type === "pdf") return FileText;
  return NotebookPen;
}

/** Minimal markdown to HTML — bold, italic, inline code, code blocks, lists. */
function renderMarkdown(text: string): string {
  let html = text
    // Code blocks (```...```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) =>
      `<pre class="my-2 rounded-xl bg-background/80 p-3 text-[12.5px] leading-relaxed overflow-x-auto"><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`
    )
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="rounded bg-background/60 px-1.5 py-0.5 text-[12px] font-mono">$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Unordered lists
    .replace(/^[-•]\s+(.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Ordered lists
    .replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p class="mt-1.5">');

  // Wrap consecutive <li> items
  html = html.replace(
    /(<li[^>]*>.*?<\/li>\n?)+/g,
    (match) => `<ul class="my-1 space-y-0.5">${match}</ul>`
  );

  return `<p>${html}</p>`;
}

export function ChatMessage({ role, content, sources, isStreaming }: ChatMessageProps) {
  if (role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-end"
      >
        <div className="max-w-[85%] rounded-[20px_20px_6px_20px] bg-primary px-4 py-2.5 text-[13.5px] leading-relaxed text-primary-foreground">
          {content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-start gap-2.5 max-w-[92%]">
        <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/20">
          <Sparkles className="size-3 text-accent" />
        </span>
        <div className="flex-1 rounded-[20px_20px_20px_6px] bg-secondary px-4 py-3.5 text-[13.5px] leading-relaxed text-foreground/90">
          {content ? (
            <div
              className="prose-chat"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          ) : isStreaming ? (
            <span className="inline-block animate-pulse text-muted-foreground">…</span>
          ) : null}
          {isStreaming && content && (
            <motion.span
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.6, repeat: Infinity, repeatType: "reverse" }}
              className="ml-0.5 inline-block text-accent"
            >
              ▍
            </motion.span>
          )}
        </div>
      </div>

      {!isStreaming && sources.length > 0 && (
        <div className="ml-8 flex flex-col gap-3">
          {/* Render Horizontal Carousel for Video Cards */}
          {(() => {
            const videoSources = sources.filter((s) => s.type === "video" || s.videoId);
            if (videoSources.length === 0) return null;

            return (
              <div className="w-full overflow-hidden">
                {videoSources.length > 1 && (
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-[9.5px] font-medium tracking-[0.09em] text-accent">
                      VÍDEOS ENCONTRADOS ({videoSources.length})
                    </span>
                    <span className="font-mono text-[9px] text-muted-foreground">
                      Deslize para o lado →
                    </span>
                  </div>
                )}
                <div className="flex w-full overflow-x-auto snap-x snap-mandatory gap-3 pb-2 pt-1 scrollbar-thin scrollbar-thumb-border/60">
                  {videoSources.map((videoSource) => (
                    <div
                      key={videoSource.videoId ? `video-${videoSource.videoId}` : `vid-${videoSource.title}`}
                      className={cn(
                        "snap-center shrink-0 min-w-0 transition-all",
                        videoSources.length > 1 ? "w-[90%] sm:w-[480px]" : "w-full"
                      )}
                    >
                      <InlineVideoCard
                        videoId={videoSource.videoId!}
                        title={videoSource.title === "Item" ? "Vídeo JW" : videoSource.title}
                        videoUrl={videoSource.videoUrl}
                        coverImage={videoSource.coverImage}
                        durationFormatted={videoSource.durationFormatted}
                        subtitlesUrl={videoSource.subtitlesUrl}
                        snippet={videoSource.snippet}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Render regular source pill links */}
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[9.5px] font-medium tracking-[0.09em] text-muted-foreground">
              FONTES
            </span>
            <div className="flex flex-wrap gap-1.5">
              {sources.map((source, idx) => {
                const isVideo = source.type === "video" || Boolean(source.videoId);
                const Icon = isVideo ? Video : sourceIcon(source.type);
                const uniqueKey = source.videoId
                  ? `video-${source.videoId}-${idx}`
                  : source.noteId
                  ? `note-${source.noteId}-${source.chapterTitle ?? ""}-${idx}`
                  : `src-${idx}-${source.title}`;
                return (
                  <Link
                    key={uniqueKey}
                    href={sourceHref(source)}
                    target={isVideo ? "_blank" : undefined}
                    rel={isVideo ? "noopener noreferrer" : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11.5px] text-accent",
                      "transition-colors hover:bg-accent/20 hover:border-accent/50"
                    )}
                  >
                    <Icon className="size-3 shrink-0" />
                    <span className="truncate max-w-[180px]">
                      {source.chapterTitle
                        ? `${source.title} — ${source.chapterTitle}`
                        : source.title}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
