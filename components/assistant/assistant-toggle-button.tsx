"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistantStore } from "@/lib/store/assistant-store";

export function AssistantToggleButton() {
  const toggleOpen = useAssistantStore((s) => s.toggleOpen);
  const open = useAssistantStore((s) => s.open);

  return (
    <Button
      variant={open ? "secondary" : "ghost"}
      size="icon"
      aria-label="Abrir assistente IA"
      onClick={toggleOpen}
      className={open ? "text-accent border border-accent/40" : ""}
    >
      <Sparkles className="size-[18px] text-accent" />
    </Button>
  );
}
