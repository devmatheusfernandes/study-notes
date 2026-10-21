"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "system", label: "Sistema", icon: Monitor },
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
] as const;

const noop = () => () => {};

/** Same segmented-pill look as ViewModeToggle, so Aparência's controls read as one set. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the stored choice on the client — rendering it
  // during SSR would mark the wrong pill and mismatch on hydration.
  const mounted = useSyncExternalStore(noop, () => true, () => false);

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="inline-flex rounded-full border border-border bg-secondary p-1"
    >
      {OPTIONS.map((option) => {
        const active = mounted && theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(option.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors",
              active
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <option.icon className="size-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
