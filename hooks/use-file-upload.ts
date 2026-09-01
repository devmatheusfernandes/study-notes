"use client";

import { useState } from "react";
import { notify } from "@/components/ui/toaster";
import { useNotesStore } from "@/lib/store/notes-store";
import { uploadFiles, type UploadedFile } from "@/app/(app)/files-actions";
import { ingestJwpubWithFeedback } from "@/lib/jwpub/ingest";

/**
 * Matches each just-uploaded `.jwpub` back to its new note row (by filename,
 * which `uploadFiles` echoes back) and kicks off parsing.
 */
async function ingestUploadedPublications(originals: File[], uploaded: UploadedFile[]) {
  for (const file of originals) {
    if (!file.name.toLowerCase().endsWith(".jwpub")) continue;
    const row = uploaded.find((u) => u.title === file.name);
    if (!row) continue;
    await ingestJwpubWithFeedback(file, row.id, file.name);
  }
}

/** Shared upload flow for both the mobile header button and desktop drag-and-drop. */
export function useFileUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const addFiles = useNotesStore((s) => s.addFiles);

  async function upload(files: File[], folderId?: string) {
    if (files.length === 0) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const result = await uploadFiles(formData, folderId);

      if (result.files.length > 0) {
        addFiles(result.files, folderId);
        // Publications get parsed in the browser after the card already exists,
        // so a parse failure just leaves a normal file card behind.
        void ingestUploadedPublications(files, result.files);
      }
      if (result.error) {
        notify.error("Não foi possível concluir o envio", result.error);
      } else if (result.files.length > 0) {
        notify.success(
          result.files.length === 1 ? "Arquivo enviado" : `${result.files.length} arquivos enviados`
        );
      }
    } catch {
      notify.error("Não foi possível enviar os arquivos", "Verifique sua conexão e tente novamente.");
    } finally {
      setIsUploading(false);
    }
  }

  return { upload, isUploading };
}
