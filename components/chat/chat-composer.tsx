"use client";

import { useRef, useEffect, useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatComposer({
  onSend,
  disabled = false,
  placeholder = "Pergunte às suas notas ou solicite um estudo…",
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 175)}px`;
  }, [value]);

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <div
      className={cn(
        "group relative flex items-end gap-3 rounded-[28px] sm:rounded-[32px] border transition-all duration-200 px-4 py-3 sm:px-5 sm:py-3.5",
        "bg-[#211f1e]/90 dark:bg-[#1c1a18]/90 backdrop-blur-2xl shadow-[0_12px_36px_rgba(0,0,0,0.5)]",
        disabled
          ? "border-border/40 opacity-60"
          : "border-white/12 hover:border-white/20 focus-within:border-accent/60 focus-within:shadow-[0_14px_44px_rgba(0,0,0,0.65)] focus-within:ring-2 focus-within:ring-accent/20"
      )}
    >
      <div className="mb-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Sparkles className="size-3.5" />
      </div>

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
  );
}

