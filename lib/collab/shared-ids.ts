import type { Folder, Note } from "@/lib/store/notes-store";

/**
 * The owner's notes that are currently shared — directly, or by sitting in a
 * shared folder (at any depth). Mirrors what the database computes in
 * `shared_note_access()` (0055) closely enough for the UI: plain text notes,
 * active, not locked directly or through a folder.
 */
export function ownSharedNoteIds(
  notes: Note[],
  folders: Folder[],
  outgoingNoteIds: string[],
  outgoingFolderIds: string[],
  locked: Set<string>
): Set<string> {
  const result = new Set<string>();
  if (outgoingNoteIds.length === 0 && outgoingFolderIds.length === 0) return result;

  const direct = new Set(outgoingNoteIds);
  const sharedRoots = new Set(outgoingFolderIds);
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId ?? null]));
  const inSharedTree = (folderId: string | undefined) => {
    const seen = new Set<string>();
    let cursor: string | null = folderId ?? null;
    while (cursor && !seen.has(cursor)) {
      if (sharedRoots.has(cursor)) return true;
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    return false;
  };

  for (const note of notes) {
    if (note.type !== "nota" || note.status !== "active" || locked.has(note.id)) continue;
    if (direct.has(note.id) || inSharedTree(note.folderId)) result.add(note.id);
  }
  return result;
}
