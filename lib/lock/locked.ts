import type { Folder, Note } from "@/lib/store/notes-store";

/** Ids of folders that are locked, or sit anywhere inside a locked folder. */
export function lockedFolderIds(folders: Folder[]): Set<string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const result = new Set<string>();

  for (const folder of folders) {
    const seen = new Set<string>();
    let cursor: Folder | undefined = folder;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.locked) {
        result.add(folder.id);
        break;
      }
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
  return result;
}

/** Ids of notes locked directly or through a locked folder above them. */
export function lockedNoteIds(notes: Note[], folders: Folder[]): Set<string> {
  const lockedFolders = lockedFolderIds(folders);
  const result = new Set<string>();
  for (const note of notes) {
    if (note.locked || (note.folderId && lockedFolders.has(note.folderId))) result.add(note.id);
  }
  return result;
}
