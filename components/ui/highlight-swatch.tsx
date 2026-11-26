"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { cn } from "@/lib/utils";

/** What a highlight colour is called here: the user's own label, else the colour's name. */
export function useHighlightColorName(colorIndex: number): string {
  const label = usePreferencesStore((s) => s.highlightLabels[colorIndex]);
  return label || (JWLIBRARY_HIGHLIGHT_COLORS[colorIndex]?.name ?? "");
}

export function HighlightColorName({ colorIndex }: { colorIndex: number }) {
  return <>{useHighlightColorName(colorIndex)}</>;
}

interface HighlightSwatchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  colorIndex: number;
  selected?: boolean;
  size?: "xs" | "sm" | "md";
}

const SIZES = { xs: "size-5", sm: "size-6", md: "size-7" };

/** One colour of the highlighter. Hovering (or focusing) it shows what the user calls it. */
export function HighlightSwatch({ colorIndex, selected, size = "sm", className, style, ...props }: HighlightSwatchProps) {
  const name = useHighlightColorName(colorIndex);

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={name}
              aria-pressed={selected}
              className={cn(
                "shrink-0 rounded-full border-2 transition-transform hover:scale-110 active:scale-95",
                SIZES[size],
                selected ? "border-foreground" : "border-transparent",
                className
              )}
              style={{ backgroundColor: JWLIBRARY_HIGHLIGHT_COLORS[colorIndex]?.hex, ...style }}
              {...props}
            />
          }
        />
        <TooltipContent side="top" sideOffset={6}>
          {name}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
