/**
 * Carrying a .jwpub reader's clickable citations into a note.
 *
 * Two halves, one on each side of the clipboard:
 *
 *   - `buildJwpubClipboardHtml` runs on COPY inside the reader. The browser
 *     would put the links' own `data-jwpub-*` attributes on the clipboard, but
 *     an excerpt link names only extract ids — which publication they belong to
 *     is context the clipboard doesn't have. So the copied fragment is
 *     re-serialised with `data-jwpub-pub` stamped on every citation.
 *
 *   - `convertPastedJwpubLinks` runs on PASTE inside the note editor
 *     (`transformPastedHTML`). It rewrites those links into the same
 *     `<span data-note-ref>` the editor's own reference mark parses, so they
 *     become ordinary note references that open in the side panel.
 *
 * Both need `DOMParser`/`document`; they only ever run in the browser.
 */

const CITATION_SELECTOR = "[data-jwpub-bible-first], [data-jwpub-extract], [data-jwpub-pubref]";

/** The HTML to put on the clipboard for the current selection, or `null` when it holds no citation (let the browser copy normally). */
export function buildJwpubClipboardHtml(range: Range, publicationId: string): string | null {
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  const citations = holder.querySelectorAll<HTMLElement>(CITATION_SELECTOR);
  if (citations.length === 0) return null;
  citations.forEach((el) => el.setAttribute("data-jwpub-pub", publicationId));
  return holder.innerHTML;
}

function toSpan(source: HTMLElement, attrs: Record<string, string>): HTMLElement {
  const span = source.ownerDocument.createElement("span");
  for (const [name, value] of Object.entries(attrs)) span.setAttribute(name, value);
  while (source.firstChild) span.appendChild(source.firstChild);
  return span;
}

/** Rewrites pasted reader citations into `data-note-ref` spans; any other HTML passes through untouched. */
export function convertPastedJwpubLinks(html: string): string {
  if (!html.includes("data-jwpub-")) return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;

  doc.body.querySelectorAll<HTMLElement>(CITATION_SELECTOR).forEach((el) => {
    let replacement: HTMLElement | null = null;

    const first = Number(el.dataset.jwpubBibleFirst);
    const last = Number(el.dataset.jwpubBibleLast);
    const extractIds = (el.dataset.jwpubExtract ?? "")
      .split(",")
      .map(Number)
      .filter((id) => Number.isFinite(id));
    const mepsId = Number(el.dataset.jwpubPubref);
    const publicationId = el.dataset.jwpubPub;

    if (el.dataset.jwpubBibleFirst !== undefined && Number.isFinite(first) && Number.isFinite(last)) {
      replacement = toSpan(el, {
        "data-note-ref": "verses",
        "data-ref-verse-first": String(first),
        "data-ref-verse-last": String(last),
      });
    } else if (extractIds.length > 0 && publicationId) {
      replacement = toSpan(el, {
        "data-note-ref": "extract",
        "data-ref-publication-id": publicationId,
        "data-ref-extract-ids": extractIds.join(","),
      });
    } else if (el.dataset.jwpubPubref !== undefined && Number.isFinite(mepsId)) {
      const attrs: Record<string, string> = {
        "data-note-ref": "pubref",
        "data-ref-meps-id": String(mepsId),
      };
      if (el.dataset.jwpubPubrefPid) attrs["data-ref-pubref-pid"] = el.dataset.jwpubPubrefPid;
      replacement = toSpan(el, attrs);
    }

    if (replacement) {
      el.replaceWith(replacement);
      changed = true;
    }
  });

  return changed ? doc.body.innerHTML : html;
}
