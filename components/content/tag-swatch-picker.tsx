"use client";

import { cn } from "@/lib/utils";
import { TAG_COLORS } from "@/lib/tag-colors";

interface TagSwatchPickerProps {
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

/** Fixed-palette color picker shared by the header's create-tag flow and the Settings tag editor. */
export function TagSwatchPicker({ value, onChange, className }: TagSwatchPickerProps) {
  return (
    <div role="radiogroup" aria-label="Cor da tag" className={cn("flex flex-wrap items-center gap-2", className)}>
      {TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className={cn(
            "size-6 shrink-0 rounded-full transition-transform",
            value === color ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background" : "ring-1 ring-white/15 hover:scale-105"
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
