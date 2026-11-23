/** IndexedDB database holding the device copy of one shared note's Yjs document (y-indexeddb). */
export function collabDbName(noteId: string) {
  return `study-notes-collab:${noteId}`;
}

/** Wipes the device copy of a shared note — when access is lost, and on sign-out. */
export async function clearCollabDocument(noteId: string) {
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(collabDbName(noteId));
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch {
    // nothing stored
  }
}
