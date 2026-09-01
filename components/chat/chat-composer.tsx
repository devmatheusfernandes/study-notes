"use client";

import { useRef, useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatComposer({
  onSend,
  disabled = false,
  placeholder = "Pergunte às suas notas…",
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
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
        "flex items-end gap-2 rounded-2xl border bg-surface-elevated px-3 py-2 transition-colors",
        disabled ? "border-border/50 opacity-60" : "border-border"
      )}
    >
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
        className="min-w-0 flex-1 resize-none bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        style={{ maxHeight: 120 }}
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        aria-label="Enviar mensagem"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
      >
        <ArrowUp className="size-4" />
      </button>
    </div>
  );
}
