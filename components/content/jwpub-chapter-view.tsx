"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { sanitizeChapterHtml } from "@/lib/jwpub/sanitize";
import { saveAnswer } from "@/app/(app)/jwpub-actions";

interface JwpubChapterViewProps {
  html: string;
  publicationId: string;
  documentId: number;
  /** Saved "Your answer" text, keyed `"<documentId>:<pid>"` — see getAnswers in jwpub-actions.ts. */
  answers: Record<string, string>;
  onFootnote: (footnoteId: number) => void;
  onBibleRef: (firstVerseId: number, lastVerseId: number) => void;
}

const ANSWER_BASE_CLASS =
  "field-sizing-content min-h-16 w-full min-w-0 rounded-2xl border bg-secondary px-4 py-3 text-[13.5px] text-foreground placeholder:text-muted-foreground outline-none transition-colors duration-300";
const ANSWER_IDLE_CLASS = "border-border";
const ANSWER_TYPING_CLASS = "border-accent ring-1 ring-accent/40";
const ANSWER_SAVED_CLASS = "border-success ring-1 ring-success/40";

export function JwpubChapterView({
  html,
  publicationId,
  documentId,
  answers,
  onFootnote,
  onBibleRef,
}: JwpubChapterViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const highlightText = searchParams.get("text");

  // Footnote + bible reference click listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(event: MouseEvent) {
      const el = event.target as HTMLElement | null;

      const footnote = el?.closest<HTMLElement>("[data-jwpub-footnote]");
      if (footnote) {
        event.preventDefault();
        const id = Number(footnote.dataset.jwpubFootnote);
        if (Number.isFinite(id)) onFootnote(id);
        return;
      }

      const bible = el?.closest<HTMLElement>("[data-jwpub-bible-first]");
      if (bible) {
        event.preventDefault();
        const first = Number(bible.dataset.jwpubBibleFirst);
        const last = Number(bible.dataset.jwpubBibleLast);
        if (Number.isFinite(first) && Number.isFinite(last)) onBibleRef(first, last);
      }
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [onFootnote, onBibleRef]);

  // Progressively enhances the archive's own "Your answer" fields
  // (`<div class="gen-field" data-pid="…"><textarea>`) — restyles them to
  // match the app's Textarea primitive, fills in any previously saved value,
  // and wires up debounced autosave with the orange(typing)/green(saved)
  // border. A field's own id/name repeat across documents (verified against
  // a real archive), so `data-pid` scoped to the current documentId is the
  // only stable save key — see getAnswers/saveAnswer in jwpub-actions.ts.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fields = container.querySelectorAll<HTMLElement>(".gen-field[data-pid]");
    const cleanups: Array<() => void> = [];

    fields.forEach((field) => {
      const pid = field.dataset.pid;
      const textarea = field.querySelector("textarea");
      if (!pid || !textarea) return;

      const label = field.querySelector("label");
      if (label) {
        label.className = "mb-1.5 block text-[11.5px] font-medium text-muted-foreground";
      }
      field.classList.add("my-4");

      const savedValue = answers[`${documentId}:${pid}`] ?? "";
      textarea.value = savedValue;
      textarea.rows = 2;
      textarea.placeholder = "Escreva sua resposta…";
      textarea.className = `${ANSWER_BASE_CLASS} ${savedValue ? ANSWER_SAVED_CLASS : ANSWER_IDLE_CLASS}`;

      let saveTimer: ReturnType<typeof setTimeout> | null = null;

      async function persist() {
        const result = await saveAnswer(publicationId, documentId, pid!, textarea!.value);
        textarea!.className = `${ANSWER_BASE_CLASS} ${result.error ? ANSWER_TYPING_CLASS : ANSWER_SAVED_CLASS}`;
      }

      function handleInput() {
        textarea!.className = `${ANSWER_BASE_CLASS} ${ANSWER_TYPING_CLASS}`;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void persist(), 800);
      }

      function handleBlur() {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
          void persist();
        }
      }

      textarea.addEventListener("input", handleInput);
      textarea.addEventListener("blur", handleBlur);
      cleanups.push(() => {
        textarea.removeEventListener("input", handleInput);
        textarea.removeEventListener("blur", handleBlur);
        if (saveTimer) clearTimeout(saveTimer);
      });
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [html, publicationId, documentId, answers]);

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
        // Footnote markers and resolved bible refs read as tappable; unresolved inline references stay inert.
        "[&_[data-jwpub-footnote]]:cursor-pointer [&_[data-jwpub-footnote]]:text-accent [&_[data-jwpub-footnote]]:underline [&_[data-jwpub-footnote]]:underline-offset-2",
        "[&_[data-jwpub-bible-first]]:cursor-pointer [&_[data-jwpub-bible-first]]:text-accent [&_[data-jwpub-bible-first]]:underline [&_[data-jwpub-bible-first]]:underline-offset-2",
        "[&_[data-jwpub-ref]]:text-foreground/80",
      ].join(" ")}
      dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(html) }}
    />
  );
}
