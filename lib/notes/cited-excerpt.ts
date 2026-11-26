/** First and last paragraph (`data-pid`) of a saved citation snapshot. */
export function citedRangeOf(snapshot: string | undefined | null): [number, number] | null {
  if (!snapshot) return null;
  const pids = [...snapshot.matchAll(/data-pid="(\d+)"/g)].map((m) => Number(m[1]));
  return pids.length > 0 ? [Math.min(...pids), Math.max(...pids)] : null;
}

/**
 * Only the cited paragraphs of a chapter, from the user's own copy (so its
 * footnotes and highlights still work). Null when none of them are there.
 * Browser only (DOMParser).
 */
export function excerptOfChapter(html: string, [first, last]: [number, number]): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const cited = (el: Element) => {
    const pid = Number(el.getAttribute("data-pid"));
    return pid >= first && pid <= last;
  };
  const picked = [...doc.body.querySelectorAll("[data-pid]")].filter((el) => {
    if (!cited(el)) return false;
    // A paragraph inside one already taken comes along with it.
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (parent.hasAttribute("data-pid") && cited(parent)) return false;
    }
    return true;
  });
  return picked.length > 0 ? picked.map((el) => el.outerHTML).join("") : null;
}
