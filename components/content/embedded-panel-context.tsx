"use client";

import { createContext, useContext } from "react";

/**
 * True below a `FloatingWindow`. A `JwpubSidePanel` rendered there can't be the
 * reader's shared sidebar (it would open somewhere unrelated to the window), so
 * it presents itself as an overlay covering the window's own body instead.
 */
const EmbeddedPanelContext = createContext(false);

export const EmbeddedPanelProvider = EmbeddedPanelContext.Provider;

export function useEmbeddedPanel() {
  return useContext(EmbeddedPanelContext);
}
