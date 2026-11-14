"use client";

import { useEffect, useState } from "react";

/** Scrolled less than this from the top and the bar is always shown. */
const ALWAYS_SHOW_ABOVE = 64;
/** Ignore jitter: the bar only reacts once the page has moved this far in one direction. */
const THRESHOLD = 8;

/**
 * True while a bar should be tucked away: it hides on scrolling down and comes
 * back on scrolling up — the way a mobile browser's own address bar behaves.
 * Does nothing (always false) while `enabled` is off.
 */
export function useHideOnScroll(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let lastY = window.scrollY;

    function onScroll() {
      const y = window.scrollY;
      const delta = y - lastY;
      if (y < ALWAYS_SHOW_ABOVE) setHidden(false);
      else if (delta > THRESHOLD) setHidden(true);
      else if (delta < -THRESHOLD) setHidden(false);
      else return; // inside the dead zone: keep lastY so slow drags still add up
      lastY = y;
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      setHidden(false);
    };
  }, [enabled]);

  return enabled && hidden;
}
