"use client";

import { useRef, useState } from "react";
import { FolderPlus, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Vault,
  VaultBody,
  VaultContent,
  VaultHeader,
  VaultTitle,
  VaultDescription,
} from "@/components/ui/vault";
import { useDevice } from "@/hooks/ui/use-device";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useNotesStore } from "@/lib/store/notes-store";
import { useFolderViewStore } from "@/lib/store/folder-view-store";

export function HeaderActions() {
  const { isMobile } = useDevice();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const { upload, isUploading } = useFileUpload();

  const createFolder = useNotesStore((s) => s.createFolder);
  const folders = useNotesStore((s) => s.folders);
  const activeFolderId = useFolderViewStore((s) => s.activeFolderId);
  const activeFolderName = folders.find((f) => f.id === activeFolderId)?.name;

  function submitFolder() {
    const trimmed = name.trim();
    if (!trimmed) return;
    createFolder(trimmed, activeFolderId ?? undefined);
    setName("");
    setOpen(false);
  }

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    void upload(Array.from(list), activeFolderId ?? undefined);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <>
      {/* Desktop uploads happen by dropping files onto the content area instead. */}
      {isMobile && (
        <>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.jwpub,.png,.jpg,.jpeg,.webp"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Enviar arquivos"
            isLoading={isUploading}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="size-[18px]" />
          </Button>
        </>
      )}

      <Button variant="ghost" size="icon" aria-label="Criar pasta" onClick={() => setOpen(true)}>
        <Plus className="size-[18px]" />
      </Button>

      <Vault open={open} onOpenChange={setOpen}>
        <VaultContent aria-label="Criar pasta">
          <VaultHeader showCloseButton={false}>
            <VaultTitle>Nova pasta</VaultTitle>
            <VaultDescription>
              {activeFolderName
                ? `Será criada dentro de "${activeFolderName}".`
                : "Organize suas notas e arquivos em um só lugar."}
            </VaultDescription>
          </VaultHeader>
          <VaultBody>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitFolder();
                }
              }}
              placeholder="Nome da pasta"
              aria-label="Nome da pasta"
            />
            {/* Button carries `shrink-0`, so each needs its own flex-1 wrapper
                to share the row instead of overflowing it. */}
            <div className="flex gap-2">
              <div className="flex-1">
                <Button variant="outline" fullWidth onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
              </div>
              <div className="flex-1">
                <Button
                  fullWidth
                  leftIcon={<FolderPlus />}
                  disabled={!name.trim()}
                  onClick={submitFolder}
                >
                  Criar pasta
                </Button>
              </div>
            </div>
          </VaultBody>
        </VaultContent>
      </Vault>
    </>
  );
}
