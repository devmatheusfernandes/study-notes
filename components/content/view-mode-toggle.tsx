"use client";

import { LayoutGrid, List } from "lucide-react";
import { SegmentedPills } from "@/components/ui/segmented-pills";
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
    <SegmentedPills
      aria-label="Modo de visualização"
      options={OPTIONS}
      value={hydrated ? viewMode : undefined}
      onChange={setViewMode}
    />
  );
}
