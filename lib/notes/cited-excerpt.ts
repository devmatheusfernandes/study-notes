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
  if (picked.length === 0) return null;
  keepPageMarkers(doc, picked);
  return picked.map((el) => el.outerHTML).join("");
}

/**
 * Page markers sit in the running text, so cutting paragraphs out loses some:
 * the one for the page the excerpt starts on (it came earlier), and any placed
 * between two paragraphs. Each is moved to the start of the paragraph it opens.
 */
function keepPageMarkers(doc: Document, picked: Element[]) {
  const markers = [...doc.body.querySelectorAll(".pageNum[data-no]")];
  const precedes = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  picked.forEach((paragraph, index) => {
    // Already starts with its own number.
    const own = paragraph.querySelector(".pageNum[data-no]");
    if (own && !textBefore(paragraph, own)) return;
    const earlier = markers.filter((m) => !paragraph.contains(m) && precedes(m, paragraph));
    const last = earlier[earlier.length - 1];
    if (!last) return;
    // For later paragraphs, only a marker that fell between the two (not one inside the previous).
    const previous = picked[index - 1];
    if (previous && (previous.contains(last) || precedes(last, previous))) return;
    paragraph.prepend(last.cloneNode(true));
  });
}

function textBefore(root: Element, node: Node): boolean {
  const range = root.ownerDocument.createRange();
  range.setStart(root, 0);
  range.setEndBefore(node);
  return range.toString().trim().length > 0;
}
