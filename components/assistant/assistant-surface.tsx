"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, X } from "lucide-react";
import { useDevice } from "@/hooks/ui/use-device";
import { useAssistantStore, type AssistantSource } from "@/lib/store/assistant-store";
import { Vault, VaultContent, VaultTitle } from "@/components/ui/vault";
import { AssistantDock } from "./assistant-dock";

function sourceHref(source: AssistantSource): string {
  if (!source.noteId) return "/notes";
  if (source.chapterTitle) {
    const match = source.chapterTitle.match(/capítulo\s+(\d+)/i) || source.chapterTitle.match(/cap\.?\s*(\d+)/i);
    if (match?.[1]) {
      return `/notes/${source.noteId}?chapter=${match[1]}`;
    }
  }
  if (source.documentId) {
    return `/notes/${source.noteId}?chapter=${source.documentId}`;
  }
  return `/notes/${source.noteId}`;
}

function renderMarkdown(text: string): string {
  let html = text
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) =>
      `<pre class="my-2 rounded-xl bg-background/80 p-3 text-[12.5px] leading-relaxed overflow-x-auto"><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`
    )
    .replace(/`([^`]+)`/g, '<code class="rounded bg-background/60 px-1.5 py-0.5 text-[12px] font-mono">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^[-•]\s+(.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/\n\n/g, '</p><p class="mt-1.5">');

  html = html.replace(
    /(<li[^>]*>.*?<\/li>\n?)+/g,
    (match) => `<ul class="my-1 space-y-0.5">${match}</ul>`
  );

  return `<p>${html}</p>`;
}

function Conversation() {
  const { question, answer, sources, isLoading, isStreaming, close } = useAssistantStore();

  return (
    <div className="flex flex-col gap-4">
      {question && (
        <div className="self-end max-w-[85%] rounded-[20px_20px_6px_20px] bg-primary px-4 py-2.5 text-[13.5px] leading-relaxed text-primary-foreground">
          {question}
        </div>
      )}

      {answer ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-[20px_20px_20px_6px] bg-secondary px-4 py-3.5 text-[13.5px] leading-relaxed text-foreground/90">
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }} />
            {isStreaming && (
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, repeatType: "reverse" }}
                className="ml-0.5 inline-block text-accent"
              >
                ▍
              </motion.span>
            )}
          </div>
          {!isStreaming && sources.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] font-medium tracking-[0.09em] text-muted-foreground">
                FONTES
              </span>
              <div className="flex flex-wrap gap-2">
                {sources.map((source) => (
                  <Link
                    key={`${source.noteId ?? ""}-${source.chapterTitle ?? source.title}`}
                    href={sourceHref(source)}
                    onClick={() => close()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-[12px] font-normal text-accent transition-colors hover:bg-accent/20"
                  >
                    <span className="font-mono text-[9px]">{source.type}</span>
                    <span className="truncate max-w-[200px]">
                      {source.chapterTitle ? `${source.title} — ${source.chapterTitle}` : source.title}
                    </span>
                    <ExternalLink className="size-3 shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : isLoading || isStreaming ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="size-1.5 rounded-full bg-accent"
          />
          gerando resposta…
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <span className="text-2xl">✨</span>
          <p className="text-xs text-muted-foreground">
            Pergunte qualquer coisa sobre suas notas ou veja suas conversas salvas.
          </p>
        </div>
      )}
    </div>
  );
}

export function AssistantSurface() {
  const { isMobile } = useDevice();
  const open = useAssistantStore((s) => s.open);
  const close = useAssistantStore((s) => s.close);

  if (isMobile) {
    return (
      <Vault open={open} onOpenChange={(next) => !next && close()}>
        <VaultContent
          aria-label="Assistente"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <VaultTitle className="sr-only">Assistente</VaultTitle>
          <div className="flex items-center gap-2 pb-4">
            <span className="size-6 shrink-0 rounded-full bg-primary" />
            <span className="mr-auto font-heading text-base">Assistente</span>
            <Link
              href="/chats"
              onClick={close}
              className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Histórico →
            </Link>
          </div>

          <Conversation />

          <div className="sticky bottom-0 -mx-6 mt-4 border-t border-border bg-background px-4 pb-1 pt-3">
            <AssistantDock variant="panel" />
          </div>
        </VaultContent>
      </Vault>
    );
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 420, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="hidden shrink-0 overflow-hidden border-l border-border bg-[#161413] md:block"
        >
          <div className="flex h-dvh w-[420px] flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-5">
              <span className="size-6 shrink-0 rounded-full bg-primary" />
              <span className="mr-auto font-heading text-base">Assistente</span>
              <Link
                href="/chats"
                onClick={close}
                className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Histórico →
              </Link>
              <button
                type="button"
                onClick={close}
                aria-label="Fechar assistente"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-5">
              <Conversation />
            </div>
            <div className="border-t border-border p-4">
              <AssistantDock variant="panel" />
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
