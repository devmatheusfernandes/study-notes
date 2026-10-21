import type { GlobalPublicationSymbol } from "@/components/content/global-publication-reader";

const GLOBAL_SYMBOLS: readonly string[] = ["it", "rsg"] satisfies GlobalPublicationSymbol[];

export function isGlobalPublicationSymbol(value: string | null | undefined): value is GlobalPublicationSymbol {
  return value != null && GLOBAL_SYMBOLS.includes(value);
}

/** Where a shared global publication's article lives — /bible renders it as a full page (see app/(app)/bible/page.tsx). */
export function globalPublicationHref(symbol: GlobalPublicationSymbol, documentId: number) {
  return `/bible?pub=${symbol}&doc=${documentId}`;
}
