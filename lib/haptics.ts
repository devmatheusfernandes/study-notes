// navigator.vibrate has no effect on iOS Safari and can throw in some
// embedded/unsupported contexts — every call here is a silent no-op rather
// than something call sites need to feature-detect around themselves.
function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

/** Light tap — checklist toggles, selection toggles. */
export function hapticTap() {
  vibrate(10);
}

/** Commit-worthy action — drag-to-create-note, destructive confirmations. */
export function hapticSuccess() {
  vibrate([10, 40, 10]);
}
