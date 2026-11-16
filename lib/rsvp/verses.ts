/** Bible verses as one `<p>` each, so the RSVP reader treats every verse as its own block. Text is escaped — it is only ever parsed, never injected. */
export function versesToHtml(verses: { text: string | null }[] | null | undefined): string {
  if (!verses) return "";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return verses
    .filter((v) => v.text && v.text.trim())
    .map((v) => `<p>${esc(v.text!)}</p>`)
    .join("");
}
