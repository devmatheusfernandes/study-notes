"use client";

import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

/** Must match --background for each palette in app/globals.css. */
const THEME_COLORS = { light: "#f8f2e9", dark: "#121110" } as const;

/**
 * The root layout's viewport emits one `theme-color` meta per
 * prefers-color-scheme, which is right while the user follows the system —
 * but an explicit "Claro"/"Escuro" choice that disagrees with the OS would
 * leave the browser chrome (Android's status bar, the PWA title bar) painted
 * in the other palette. So once the theme resolves, both tags get the colour
 * actually on screen.
 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const color = THEME_COLORS[resolvedTheme];
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.content = color;
    });
  }, [resolvedTheme]);

  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    // `class` (not data-theme) so Tailwind's `dark:` variant — remapped to
    // `.dark` in globals.css — and the token overrides both key off the same
    // thing. Preference lives in localStorage under "theme": like penOnly, it's
    // a property of the device, not the account.
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}
