"use client";

import { useState } from "react";
import { notify } from "@/components/ui/toaster";
import { useNotesStore } from "@/lib/store/notes-store";
import { uploadFiles } from "@/app/(app)/files-actions";

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
