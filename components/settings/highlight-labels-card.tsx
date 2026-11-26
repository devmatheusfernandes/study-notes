"use client";

import { useState } from "react";
import { Highlighter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import {
  HIGHLIGHT_LABEL_MAX_CHARS,
  HIGHLIGHT_LABEL_MAX_WORDS,
  normalizeHighlightLabel,
} from "@/lib/jwlibrary/highlight-labels";
import { usePreferencesStore } from "@/lib/store/preferences-store";

function LabelRow({ colorIndex }: { colorIndex: number }) {
  const color = JWLIBRARY_HIGHLIGHT_COLORS[colorIndex];
  const saved = usePreferencesStore((s) => s.highlightLabels[colorIndex] ?? "");
  const setHighlightLabel = usePreferencesStore((s) => s.setHighlightLabel);
  // Null while the field isn't being edited, so a label arriving from the server shows up.
  const [draft, setDraft] = useState<string | null>(null);
  const tooManyWords = (draft ?? "").trim().split(/\s+/).filter(Boolean).length > HIGHLIGHT_LABEL_MAX_WORDS;

  function commit() {
    if (draft === null) return;
    setHighlightLabel(colorIndex, normalizeHighlightLabel(draft));
    setDraft(null);
  }

  return (
    <div className="flex items-start gap-3">
      <span className="mt-2 size-7 shrink-0 rounded-full" style={{ backgroundColor: color.hex }} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Input
          value={draft ?? saved}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          maxLength={HIGHLIGHT_LABEL_MAX_CHARS}
          placeholder={color.name}
          aria-label={`Etiqueta da cor ${color.name}`}
          hasError={tooManyWords}
        />
        {tooManyWords && (
          <span className="px-1 text-[11.5px] text-destructive">
            No máximo {HIGHLIGHT_LABEL_MAX_WORDS} palavras — o restante será descartado.
          </span>
        )}
      </div>
    </div>
  );
}

export function HighlightLabelsCard() {
  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Highlighter className="size-4 text-accent" />
          <h3 className="font-heading text-base text-foreground">Etiquetas das cores</h3>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Um título de até {HIGHLIGHT_LABEL_MAX_WORDS} palavras para cada cor. Deixe em branco para usar o nome da cor.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.keys(JWLIBRARY_HIGHLIGHT_COLORS).map((index) => (
          <LabelRow key={index} colorIndex={Number(index)} />
        ))}
      </div>
    </section>
  );
}
