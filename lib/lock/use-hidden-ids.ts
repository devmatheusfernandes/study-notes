"use client";

import { useMemo } from "react";
import { useNotesStore } from "@/lib/store/notes-store";
import { useLockStore } from "@/lib/store/lock-store";
import { lockedFolderIds, lockedNoteIds } from "./locked";

const EMPTY: ReadonlySet<string> = new Set();

/** Notes locked right now: locked directly or via a folder, AND the session isn't unlocked. */
export function useHiddenNoteIds(): ReadonlySet<string> {
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const unlocked = useLockStore((s) => s.unlocked);
  return useMemo(() => (unlocked ? EMPTY : lockedNoteIds(notes, folders)), [notes, folders, unlocked]);
}

/** Folders locked right now (themselves or an ancestor), while the session isn't unlocked. */
export function useHiddenFolderIds(): ReadonlySet<string> {
  const folders = useNotesStore((s) => s.folders);
  const unlocked = useLockStore((s) => s.unlocked);
  return useMemo(() => (unlocked ? EMPTY : lockedFolderIds(folders)), [folders, unlocked]);
}
