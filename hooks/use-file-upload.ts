"use client";

import { useState } from "react";
import { notify } from "@/components/ui/toaster";
import { useNotesStore } from "@/lib/store/notes-store";
import { uploadFiles, type UploadedFile } from "@/app/(app)/files-actions";
import { ingestJwpubWithFeedback } from "@/lib/jwpub/ingest";
import {
  isNoteImportFile,
  parseFileToNotes,
  type DiscoveredFile,
} from "@/lib/import-notes";

/**
 * Matches each just-uploaded `.jwpub` back to its new note row (by filename,
 * which `uploadFiles` echoes back), kicks off parsing, and flips the card's
 * `processing` flag off once ingest settles — that's what makes it clickable
 * and triggers the card's "just ready" flash. Also swaps the card's title
 * from the raw filename to the publication's real title, once known —
 * ingestJwpub already wrote it server-side, this just mirrors it locally so
 * the card doesn't wait for a full reload to show it.
 */
async function ingestUploadedPublications(
  originals: File[],
  uploaded: UploadedFile[],
  setNoteProcessing: (id: string, processing: boolean) => void,
  setNoteTitle: (id: string, title: string) => void
) {
  for (const file of originals) {
    if (!file.name.toLowerCase().endsWith(".jwpub")) continue;
    const row = uploaded.find((u) => u.title === file.name);
    if (!row) continue;
    const result = await ingestJwpubWithFeedback(file, row.id, file.name);
    if (result.title) setNoteTitle(row.id, result.title);
    setNoteProcessing(row.id, false);
  }
}

/** Shared upload & note import flow for header button, drop zone, and folder cards. */
export function useFileUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const addOptimisticFile = useNotesStore((s) => s.addOptimisticFile);
  const resolveOptimisticFile = useNotesStore((s) => s.resolveOptimisticFile);
  const failOptimisticFile = useNotesStore((s) => s.failOptimisticFile);
  const setNoteProcessing = useNotesStore((s) => s.setNoteProcessing);
  const setNoteTitle = useNotesStore((s) => s.setNoteTitle);
  const addNote = useNotesStore((s) => s.addNote);
  const createFolder = useNotesStore((s) => s.createFolder);

  /** Resolves or creates nested subfolders for OS folder structures. */
  function resolveFolderForPath(
    folderPath: string[],
    targetFolderId?: string
  ): string | undefined {
    if (folderPath.length === 0) return targetFolderId;

    let currentParentId = targetFolderId;
    const folderCache = new Map<string, string>();

    for (let i = 0; i < folderPath.length; i++) {
      const pathKey = folderPath.slice(0, i + 1).join("/");
      if (folderCache.has(pathKey)) {
        currentParentId = folderCache.get(pathKey);
        continue;
      }

      const segmentName = folderPath[i];
      const existingFolders = useNotesStore.getState().folders;
      const match = existingFolders.find(
        (f) =>
          f.name.toLowerCase() === segmentName.toLowerCase() &&
          (f.parentId ?? null) === (currentParentId ?? null)
      );

      if (match) {
        currentParentId = match.id;
      } else {
        currentParentId = createFolder(segmentName, currentParentId);
      }
      folderCache.set(pathKey, currentParentId);
    }

    return currentParentId;
  }

  async function processDiscoveredItems(
    items: DiscoveredFile[],
    targetFolderId?: string
  ) {
    if (items.length === 0) return;
    setIsUploading(true);

    try {
      let createdNotesCount = 0;
      const binaryFilesByFolder = new Map<
        string,
        { folderId?: string; files: File[] }
      >();

      for (const item of items) {
        const itemFolderId = resolveFolderForPath(item.folderPath, targetFolderId);

        if (isNoteImportFile(item.file)) {
          try {
            const notes = await parseFileToNotes(item.file);
            for (const note of notes) {
              const noteFolderId =
                note.folderPath && note.folderPath.length > 0
                  ? resolveFolderForPath(note.folderPath, targetFolderId)
                  : itemFolderId;
              addNote({
                title: note.title,
                body: note.body,
                folderId: noteFolderId,
              });
              createdNotesCount++;
            }
          } catch {
            notify.error(`Falha ao ler o arquivo "${item.file.name}"`);
          }
        } else {
          const key = itemFolderId ?? "__root__";
          if (!binaryFilesByFolder.has(key)) {
            binaryFilesByFolder.set(key, {
              folderId: itemFolderId,
              files: [],
            });
          }
          binaryFilesByFolder.get(key)!.files.push(item.file);
        }
      }

      let totalUploadedFiles = 0;

      for (const { folderId, files } of binaryFilesByFolder.values()) {
        if (files.length === 0) continue;

        // Optimistic cards appear the instant the batch is about to be sent —
        // not clickable yet (see NoteCard's `processing` prop) — so the user
        // sees the file land immediately instead of waiting on the round trip.
        const tempIdByFile = new Map(files.map((file) => [file, addOptimisticFile(file, folderId)]));

        const formData = new FormData();
        files.forEach((file) => formData.append("files", file));

        const result = await uploadFiles(formData, folderId);

        for (const file of files) {
          const tempId = tempIdByFile.get(file)!;
          const uploaded = result.files.find((u) => u.title === file.name);
          if (!uploaded) {
            failOptimisticFile(tempId);
            continue;
          }
          // .jwpub needs a further parse-and-persist pass before it's readable;
          // everything else is ready to open as soon as the upload lands.
          const stillProcessing = file.name.toLowerCase().endsWith(".jwpub");
          resolveOptimisticFile(tempId, uploaded, stillProcessing);
        }

        if (result.files.length > 0) {
          totalUploadedFiles += result.files.length;
          void ingestUploadedPublications(files, result.files, setNoteProcessing, setNoteTitle);
        }
        if (result.error) {
          notify.error("Não foi possível concluir o envio de alguns arquivos", result.error);
        }
      }

      // User feedback toasts
      if (createdNotesCount > 0 && totalUploadedFiles > 0) {
        notify.success(
          `${createdNotesCount} ${createdNotesCount === 1 ? "nota criada" : "notas criadas"} e ${totalUploadedFiles} ${totalUploadedFiles === 1 ? "arquivo enviado" : "arquivos enviados"}`
        );
      } else if (createdNotesCount > 0) {
        notify.success(
          createdNotesCount === 1
            ? "Nota importada com sucesso"
            : `${createdNotesCount} notas importadas com sucesso`
        );
      } else if (totalUploadedFiles > 0) {
        notify.success(
          totalUploadedFiles === 1
            ? "Arquivo enviado"
            : `${totalUploadedFiles} arquivos enviados`
        );
      }
    } catch {
      notify.error("Não foi possível processar a importação", "Tente novamente.");
    } finally {
      setIsUploading(false);
    }
  }

  async function upload(files: File[], folderId?: string) {
    const discovered: DiscoveredFile[] = files.map((file) => ({
      file,
      relativePath: file.name,
      folderPath: [],
    }));
    await processDiscoveredItems(discovered, folderId);
  }

  return { upload, processDiscoveredItems, isUploading };
}
