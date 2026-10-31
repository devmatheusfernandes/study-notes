"use client";

import { useIsMobile } from "@/hooks/ui/use-device";
import { useFloatingWindowsStore } from "@/lib/store/floating-windows-store";
import { JwpubBibleSurface } from "./jwpub-bible-surface";

/**
 * Renders every open floating window. Mounted once in the (app) layout, so the
 * windows keep their place while the page underneath navigates or scrolls.
 */
export function FloatingWindowsHost() {
  const windows = useFloatingWindowsStore((s) => s.windows);
  const close = useFloatingWindowsStore((s) => s.close);
  const isMobile = useIsMobile();

  if (isMobile) return null;

  return (
    <>
      {windows.map((w) => (
        <JwpubBibleSurface
          key={w.id}
          floating={{ id: w.id }}
          open
          verses={w.verses}
          highlights={w.highlights}
          isLoading={false}
          error={null}
          onClose={() => close(w.id)}
        />
      ))}
    </>
  );
}
