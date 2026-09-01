"use client";

import { useRef, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, BookOpen, FileText, NotebookPen, Sparkles, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ChatComposerProps {
  onSend: (message: string, allowedSourceTypes: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

const SOURCE_FILTERS = [
  { id: "nota", label: "Notas", icon: NotebookPen },
  { id: "pdf", label: "PDFs", icon: FileText },
  { id: "jwpub", label: "JWPUB", icon: BookOpen },
  { id: "video", label: "Vídeos", icon: Video },
];

const STORAGE_KEY = "study-notes-source-filters";

export function ChatComposer({
  onSend,
  disabled = false,
  placeholder = "Pergunte às suas notas ou solicite um estudo…",
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<string[]>(() => {
    if (typeof window === "undefined") return ["nota", "pdf", "jwpub", "video"];
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return ["nota", "pdf", "jwpub", "video"];
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const toggleFilter = (id: string) => {
    setSelectedFilters((prev) => {
      let next: string[];
      if (prev.includes(id)) {
        next = prev.filter((item) => item !== id);
        if (next.length === 0) next = ["nota", "pdf", "jwpub", "video"]; // fallback if all deselected
      } else {
        next = [...prev, id];
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 175)}px`;
  }, [value]);

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, selectedFilters);
    setValue("");
  }

  const hasNarrowedFilters = selectedFilters.length < SOURCE_FILTERS.length;

  return (
    <div className="flex w-full flex-col gap-2">
      {/* Source Filter Pills — tucked behind the sparkles toggle so they don't
          crowd the composer by default; expands with a smooth height animation. */}
      <AnimatePresence initial={false}>
        {showFilters && (
          <motion.div
            key="filters"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-0.5 text-xs">
              <span className="mr-1 font-mono text-[10px] uppercase text-muted-foreground/80">
                Procurar em:
              </span>
              {SOURCE_FILTERS.map((f) => {
                const Icon = f.icon;
                const isSelected = selectedFilters.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFilter(f.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-all",
                      isSelected
                        ? "bg-accent/20 border border-accent/50 text-accent shadow-xs"
                        : "bg-secondary/60 border border-border/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    <Icon className="size-3 shrink-0" />
                    <span>{f.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating ChatGPT Style Composer Capsule */}
      <div
        className={cn(
          "group relative flex items-end gap-3 rounded-[28px] sm:rounded-[32px] border transition-all duration-200 px-4 py-3 sm:px-5 sm:py-3.5",
          "bg-[#211f1e]/90 dark:bg-[#1c1a18]/90 backdrop-blur-2xl shadow-[0_12px_36px_rgba(0,0,0,0.5)]",
          disabled
            ? "border-border/40 opacity-60"
            : "border-white/12 hover:border-white/20 focus-within:border-accent/60 focus-within:shadow-[0_14px_44px_rgba(0,0,0,0.65)] focus-within:ring-2 focus-within:ring-accent/20"
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          animation="none"
          onClick={() => setShowFilters((v) => !v)}
          aria-label="Filtros de busca"
          aria-expanded={showFilters}
          className={cn(
            "relative mb-1 size-7 shrink-0 rounded-full text-accent transition-colors",
            showFilters ? "bg-accent/25" : "bg-accent/15 hover:bg-accent/25"
          )}
        >
          <Sparkles className="size-3.5" />
          {hasNarrowedFilters && !showFilters && (
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-[#211f1e]" />
          )}
        </Button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="min-h-[26px] max-h-44 flex-1 resize-none bg-transparent text-[14.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          aria-label="Enviar mensagem"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full transition-all duration-200",
            value.trim() && !disabled
              ? "bg-primary text-primary-foreground shadow-md hover:bg-accent hover:scale-105 active:scale-95"
              : "bg-secondary/70 text-muted-foreground opacity-40 cursor-not-allowed"
          )}
        >
          <ArrowUp className="size-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
}

