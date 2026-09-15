// Pure, framework-agnostic — imported by both the client notes store and the
// server upload action, so it must not pull in "use client" or "use server"
// code from either side (that would create a circular import).

export type NoteType = "nota" | "pdf" | "docx" | "xlsx" | "jwpub" | "jwlibrary" | "arquivo";

/** Maps an uploaded file's extension onto one of our card types. */
export function typeFromFileName(name: string): NoteType {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "doc" || ext === "docx") return "docx";
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return "xlsx";
  if (ext === "jwpub") return "jwpub";
  if (ext === "jwlibrary") return "jwlibrary";
  return "arquivo";
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
