"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { SegmentedPills } from "@/components/ui/segmented-pills";

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
    <SegmentedPills
      aria-label="Tema"
      options={[...OPTIONS]}
      value={mounted ? (theme as (typeof OPTIONS)[number]["value"]) : undefined}
      onChange={setTheme}
    />
  );
}
