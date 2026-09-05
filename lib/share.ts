export type ShareResult = "shared" | "copied" | "unsupported";

/**
 * navigator.share (native share sheet) with a clipboard fallback for
 * browsers that don't support it (desktop Chrome/Firefox). A user cancelling
 * the native share sheet throws AbortError — that's not a failure, so it's
 * swallowed rather than surfaced.
 */
export async function shareNote(title: string, text: string, url?: string): Promise<ShareResult> {
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "shared";
      // fall through to clipboard on any other failure (e.g. permission denied)
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText([title, text, url].filter(Boolean).join("\n\n"));
    return "copied";
  }

  return "unsupported";
}
