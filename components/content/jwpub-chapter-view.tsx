"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { sanitizeChapterHtml } from "@/lib/jwpub/sanitize";

interface JwpubChapterViewProps {
  html: string;
  onFootnote: (footnoteId: number) => void;
}

export function JwpubChapterView({ html, onFootnote }: JwpubChapterViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const highlightText = searchParams.get("text");

  // Footnote click listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(event: MouseEvent) {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-jwpub-footnote]"
      );
      if (!target) return;
      event.preventDefault();
      const id = Number(target.dataset.jwpubFootnote);
      if (Number.isFinite(id)) onFootnote(id);
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [onFootnote]);

  // Auto-scroll & Highlight matching snippet from chat RAG source
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !highlightText) return;

    const lowerTarget = highlightText.toLowerCase();
    const elements = container.querySelectorAll("p, blockquote, li, h1, h2, h3");

    for (const el of Array.from(elements)) {
      if (el.textContent?.toLowerCase().includes(lowerTarget)) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-accent", "bg-accent/20", "rounded-xl", "p-2.5", "transition-all", "duration-500");

        const timer = setTimeout(() => {
          el.classList.remove("ring-2", "ring-accent", "bg-accent/20");
        }, 4500);

        return () => clearTimeout(timer);
      }
    }
  }, [html, highlightText]);

  return (
    <motion.div
      key={html.slice(0, 64)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      ref={containerRef}
      className={[
        "mx-auto w-full max-w-2xl text-[15px] leading-relaxed text-foreground/90",
        "[&_h1]:font-heading [&_h1]:text-2xl [&_h1]:leading-tight [&_h1]:mt-6 [&_h1]:mb-3",
        "[&_h2]:font-heading [&_h2]:text-xl [&_h2]:leading-tight [&_h2]:mt-6 [&_h2]:mb-2.5",
        "[&_h3]:font-heading [&_h3]:text-lg [&_h3]:mt-5 [&_h3]:mb-2",
        "[&_p]:my-3 [&_p]:text-pretty",
        "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-accent/40 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
        "[&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-2xl",
        "[&_table]:my-4 [&_table]:w-full [&_table]:text-[13.5px] [&_td]:border [&_td]:border-border [&_td]:p-2",
        // Footnote markers read as tappable, inline references stay inert.
        "[&_[data-jwpub-footnote]]:cursor-pointer [&_[data-jwpub-footnote]]:text-accent [&_[data-jwpub-footnote]]:underline [&_[data-jwpub-footnote]]:underline-offset-2",
        "[&_[data-jwpub-ref]]:text-foreground/80",
      ].join(" ")}
      dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(html) }}
    />
  );
}
