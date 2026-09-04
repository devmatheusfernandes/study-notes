"use client";

import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePreferencesStore, type ViewMode } from "@/lib/store/preferences-store";
import { useHydrated } from "@/components/providers/store-hydration";

const OPTIONS: { value: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { value: "grid", label: "Grade", icon: LayoutGrid },
  { value: "list", label: "Lista", icon: List },
];

interface ViewModeToggleProps {
  /** Controlled mode — when given (with `onChange`), overrides the global `viewMode` preference. Used by /jwlibrary, which has its own independent view-mode setting. */
  value?: ViewMode;
  onChange?: (mode: ViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps = {}) {
  const hydrated = useHydrated();
  const globalViewMode = usePreferencesStore((s) => s.viewMode);
  const setGlobalViewMode = usePreferencesStore((s) => s.setViewMode);
  const viewMode = value ?? globalViewMode;
  const setViewMode = onChange ?? setGlobalViewMode;

  return (
    <div
      role="radiogroup"
      aria-label="Modo de visualização"
      className="inline-flex rounded-full border border-border bg-secondary p-1"
    >
      {OPTIONS.map((option) => {
        const active = hydrated && viewMode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setViewMode(option.value)}
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
