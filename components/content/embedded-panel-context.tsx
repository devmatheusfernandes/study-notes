"use client";

import { createContext, useContext } from "react";

/**
 * Where a `JwpubSidePanel` is rendered when it can't be a column of the reader's
 * shared sidebar, so it presents itself as an overlay over its host's body
 * instead (with a back arrow):
 *
 *  - `"window"`: below a `FloatingWindow` — a panel there would otherwise open
 *    somewhere unrelated to the window.
 *  - `"sidebar"`: below another side panel that asked for in-place navigation
 *    (`JwpubSidePanel`'s `overlays`) — a citation opened from the study panel
 *    replaces the panel's content, with a way back, rather than stacking a
 *    second panel on top.
 *  - `false`: a regular panel.
 */
export type EmbeddedPanelKind = false | "window" | "sidebar";

const EmbeddedPanelContext = createContext<EmbeddedPanelKind>(false);

export const EmbeddedPanelProvider = EmbeddedPanelContext.Provider;

export function useEmbeddedPanel() {
  return useContext(EmbeddedPanelContext);
}
