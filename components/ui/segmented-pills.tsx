"use client";

import type { ComponentType, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The app's segmented control: a pill track with one pill per option, the
 * chosen one filled with the primary colour. Used by the view-mode and theme
 * toggles, the share-permission choice and the /notes "Pastas · Compartilhado
 * comigo" switch.
 */
const trackVariants = cva("inline-flex rounded-full border border-border bg-secondary", {
  variants: {
    size: {
      default: "p-1",
      sm: "p-0.5",
    },
  },
  defaultVariants: { size: "default" },
});

const pillVariants = cva("flex items-center gap-1.5 rounded-full transition-colors", {
  variants: {
    size: {
      default: "px-3.5 py-1.5 text-[12.5px]",
      // Small enough to sit where a section label used to be.
      sm: "px-3 py-1 font-mono text-[10.5px] font-medium tracking-[0.08em]",
    },
    active: {
      true: "bg-primary font-semibold text-primary-foreground",
      false: "text-muted-foreground hover:text-foreground",
    },
  },
  defaultVariants: { size: "default", active: false },
});

export interface SegmentedPillOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** Small count shown after the label (e.g. pending invites). Hidden when 0. */
  badge?: number;
}

interface SegmentedPillsProps<T extends string> extends VariantProps<typeof trackVariants> {
  options: SegmentedPillOption<T>[];
  /** `undefined` marks nothing as chosen (e.g. before a stored value is known). */
  value: T | undefined;
  onChange: (value: T) => void;
  "aria-label": string;
  className?: string;
}

export function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
  size,
  className,
  "aria-label": ariaLabel,
}: SegmentedPillsProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn(trackVariants({ size }), className)}>
      {options.map((option) => {
        const active = value === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={pillVariants({ size, active })}
          >
            {Icon && <Icon className={size === "sm" ? "size-3" : "size-3.5"} />}
            {option.label}
            {!!option.badge && (
              <span
                className={cn(
                  "min-w-4 rounded-full px-1 text-center font-mono text-[10px] leading-4",
                  active ? "bg-primary-foreground/20" : "bg-primary text-primary-foreground"
                )}
              >
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
