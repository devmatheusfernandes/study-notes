const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/** "840 KB", "312,4 MB", "10,0 GB" — switches to GB as soon as it is one, rather than printing "10286,9 MB". */
export function formatBytes(bytes: number): string {
  const one = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (bytes >= GB) return `${one(bytes / GB)} GB`;
  if (bytes >= MB) return `${one(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / KB))} KB`;
}
