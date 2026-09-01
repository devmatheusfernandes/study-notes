/** Note bodies are Tiptap HTML (or a plain-text one-liner for file cards) — strip tags before matching. */
function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

/** Case-insensitive substring match across one or more fields (title, body, folder name…). An empty query always matches. */
export function matchesSearch(query: string, ...fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => stripHtml(field).toLowerCase().includes(q));
}
