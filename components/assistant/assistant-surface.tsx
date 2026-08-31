"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, X } from "lucide-react";
import { useDevice } from "@/hooks/ui/use-device";
import { useAssistantStore } from "@/lib/store/assistant-store";
import { Vault, VaultContent, VaultTitle } from "@/components/ui/vault";
import { Badge } from "@/components/ui/badge";
import { AssistantDock } from "./assistant-dock";

function Conversation() {
  const { question, answer, sources, isLoading } = useAssistantStore();

  return (
    <div className="flex flex-col gap-4">
      <div className="self-end max-w-[85%] rounded-[20px_20px_6px_20px] bg-primary px-4 py-2.5 text-[13.5px] leading-relaxed text-primary-foreground">
        {question}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="size-1.5 rounded-full bg-accent"
          />
          gerando…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-[20px_20px_20px_6px] bg-secondary px-4 py-3.5 text-[13.5px] leading-relaxed text-foreground/90">
            {answer}
          </div>
          {sources.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] font-medium tracking-[0.09em] text-muted-foreground">
                FONTES
              </span>
              <div className="flex flex-wrap gap-2">
                {sources.map((source) => (
                  <Badge
                    key={source.title}
                    variant="outline"
                    className="h-auto gap-1.5 rounded-full border-accent/40 px-3 py-1.5 text-[12px] font-normal text-accent"
                  >
                    <span className="font-mono text-[9px]">{source.type}</span>
                    {source.title}
                    <ExternalLink className="size-3" />
                  </Badge>
                ))}
              </div>
            </div>
          )}
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
          // Without this the sheet focuses the composer on open and the
          // keyboard immediately covers the answer.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <VaultTitle className="sr-only">Assistente</VaultTitle>
          <div className="flex items-center gap-2 pb-4">
            <span className="size-6 shrink-0 rounded-full bg-primary" />
            <span className="mr-auto font-heading text-base">Assistente</span>
            <Badge variant="success" className="h-auto rounded-full px-2.5 py-1 font-mono text-[10px]">
              RAG
            </Badge>
          </div>

          <Conversation />

          {/* Sticks to the bottom of the sheet's scroll area so follow-up
              questions stay reachable however long the answer gets. */}
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
            <header className="flex items-center gap-2.5 border-b border-border px-5 py-4">
              <span className="size-6 shrink-0 rounded-full bg-primary" />
              <span className="mr-auto font-heading text-base">Assistente</span>
              <Badge
                variant="success"
                className="h-auto rounded-full px-2.5 py-1 font-mono text-[10px]"
              >
                RAG
              </Badge>
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
            {/* The composer moves in here while the panel is open. */}
            <div className="border-t border-border p-4">
              <AssistantDock variant="panel" />
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
