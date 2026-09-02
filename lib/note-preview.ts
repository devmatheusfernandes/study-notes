/** Cards are previews — long notes would otherwise blow out a masonry column, especially on narrow mobile columns. */
const MAX_PREVIEW_CHARS = 120;
/** Keep-style cards show a handful of checklist items, not the whole list. */
const MAX_CHECKLIST_ITEMS = 5;

/** Marks worth keeping visible in a truncated card excerpt — bold/italic/etc, not block structure. */
const INLINE_TAGS = new Set(["strong", "em", "b", "i", "s", "del", "u", "mark", "code"]);

export interface ChecklistPreviewItem {
  text: string;
  checked: boolean;
}

export interface NotePreview {
  /** Truncated excerpt as a small HTML string (may contain <strong>/<em>/etc) — render with dangerouslySetInnerHTML, not as plain text. */
  html?: string;
  imageUrl?: string;
  checklist?: ChecklistPreviewItem[];
  checklistRemaining?: number;
}

function escapeHtml(raw: string) {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Walks the body depth-first, keeping inline formatting tags intact and
 * stopping once the character budget runs out — a naive substring truncation
 * of the raw HTML would risk cutting a tag in half.
 */
function truncateToHtml(root: Node, budget: { used: number; done: boolean }): string {
  if (budget.done) return "";

  if (root.nodeType === Node.TEXT_NODE) {
    const raw = root.textContent ?? "";
    const remaining = MAX_PREVIEW_CHARS - budget.used;
    if (raw.length <= remaining) {
      budget.used += raw.length;
      return escapeHtml(raw);
    }
    budget.done = true;
    const cut = raw.slice(0, Math.max(0, remaining)).trimEnd();
    budget.used = MAX_PREVIEW_CHARS;
    return cut ? `${escapeHtml(cut)}…` : "";
  }

  if (root.nodeType !== Node.ELEMENT_NODE) return "";

  const el = root as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "img") return ""; // images get their own preview slot, not inlined into the excerpt

  let inner = "";
  for (const child of Array.from(el.childNodes)) {
    inner += truncateToHtml(child, budget);
    if (budget.done) break;
  }
  if (!inner) return "";

  // Preserve the tag for inline formatting; block-level elements (p, div, li…)
  // just contribute their text with a separating space, since the excerpt is
  // a single flowing line, not a re-rendering of the note's block structure.
  return INLINE_TAGS.has(tag) ? `<${tag}>${inner}</${tag}>` : `${inner} `;
}

/**
 * Turns a note's rich-text HTML body (or a plain-text body — files and
 * pre-rich-text notes never had HTML in the first place, and DOMParser
 * handles both the same way) into whatever a card should actually render:
 * a Keep-style checklist, a leading image thumbnail, or a truncated excerpt
 * that keeps bold/italic/etc. Only ever called client-side — NoteCard only
 * renders once the notes store has hydrated, so DOMParser is always available.
 */
export function parseNotePreview(body: string): NotePreview {
  const doc = new DOMParser().parseFromString(body, "text/html");

  // Tiptap's TaskList renders `data-type="taskList"` on the <ul>, but its
  // TaskItem does NOT put a matching data-type on the <li> itself — only
  // `data-checked`, which is what actually distinguishes it from a plain list.
  const taskItems = Array.from(doc.querySelectorAll('ul[data-type="taskList"] > li[data-checked]'));
  if (taskItems.length > 0) {
    const checklist = taskItems.slice(0, MAX_CHECKLIST_ITEMS).map((li) => ({
      text: (li.textContent ?? "").trim(),
      checked: li.getAttribute("data-checked") === "true",
    }));
    return { checklist, checklistRemaining: Math.max(0, taskItems.length - MAX_CHECKLIST_ITEMS) };
  }

  const imageUrl = doc.querySelector("img")?.getAttribute("src") ?? undefined;

  const budget = { used: 0, done: false };
  let html = "";
  for (const child of Array.from(doc.body.childNodes)) {
    html += truncateToHtml(child, budget);
    if (budget.done) break;
  }
  html = html.trim();

  return { imageUrl, html: html || undefined };
}

/**
 * Flips one checklist item's checked state directly in the stored HTML,
 * keyed by its index among ALL task items (not just the ones a preview
 * happens to show) — matches the indices `parseNotePreview` hands out for
 * the first `MAX_CHECKLIST_ITEMS`, which is all a card ever lets you toggle.
 */
export function toggleChecklistItemInHtml(body: string, index: number): string {
  const doc = new DOMParser().parseFromString(body, "text/html");
  const items = doc.querySelectorAll('ul[data-type="taskList"] > li[data-checked]');
  const li = items[index];
  if (!li) return body;

  const next = li.getAttribute("data-checked") !== "true";
  li.setAttribute("data-checked", String(next));

  const checkbox = li.querySelector('input[type="checkbox"]');
  if (checkbox) {
    if (next) checkbox.setAttribute("checked", "checked");
    else checkbox.removeAttribute("checked");
  }

  return doc.body.innerHTML;
}
