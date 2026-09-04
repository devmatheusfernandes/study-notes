/**
 * Custom DataTransfer mime type used to drag note/file cards onto a folder to
 * move them. Deliberately not "Files" (or any of its variants) so it never
 * matches the existing `hasFiles()` gate that FolderCard/FileDropZone use for
 * upload-via-drop — the two drag sources coexist without extra checks.
 */
export const NOTE_DRAG_MIME = "application/x-note-ids";

export function readDraggedNoteIds(dataTransfer: DataTransfer): string[] {
  const raw = dataTransfer.getData(NOTE_DRAG_MIME);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function hasDraggedNoteIds(event: React.DragEvent) {
  return Array.from(event.dataTransfer.types).includes(NOTE_DRAG_MIME);
}
