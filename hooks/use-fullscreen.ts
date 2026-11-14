"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Whole-window fullscreen (the browser's own chrome goes away) — for reading or
 * writing a PDF or note with nothing around it. Tracks the real state through
 * `fullscreenchange`, so leaving with Esc or the system gesture keeps the
 * button honest.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Resolved after mount: the server render has no `document`.
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const sync = () => {
      const on = document.fullscreenElement !== null;
      setIsFullscreen(on);
      // The app's sidebar hides itself on this flag (see globals.css).
      document.documentElement.toggleAttribute("data-immersive", on);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(typeof document.documentElement.requestFullscreen === "function");
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.documentElement.removeAttribute("data-immersive");
    };
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Refused (no user gesture, or the platform forbids it): nothing to do.
    }
  }, []);

  return { isFullscreen, supported, toggle };
}
