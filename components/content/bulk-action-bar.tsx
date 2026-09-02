"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, CheckCheck, RotateCcw, Tags, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { useSelectionStore } from "@/lib/store/selection-store";
import { useNotesStore } from "@/lib/store/notes-store";
import type { NoteStatus } from "@/lib/store/notes-store";
import { TagPickerVault } from "./tag-picker-vault";

interface BulkActionBarProps {
  /** Which screen this is — decides whether "Arquivar" or "Restaurar" applies. */
  status: NoteStatus;
}

export function BulkActionBar({ status }: BulkActionBarProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const visibleIds = useSelectionStore((s) => s.visibleIds);
  const selectAll = useSelectionStore((s) => s.selectAll);
  const clear = useSelectionStore((s) => s.clear);
  const bulkArchive = useNotesStore((s) => s.bulkArchive);
  const bulkRestore = useNotesStore((s) => s.bulkRestore);
  const bulkTrash = useNotesStore((s) => s.bulkTrash);
  const bulkDeletePermanently = useNotesStore((s) => s.bulkDeletePermanently);

  const count = selectedIds.length;
  const isTrashed = status === "trashed";

  function handleDelete() {
    if (isTrashed) bulkDeletePermanently(selectedIds);
    else bulkTrash(selectedIds);
    clear();
  }

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
          className="pointer-events-none sticky bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6"
        >
          <div className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-3xl border border-border bg-surface-elevated px-4 py-2.5 shadow-[0_14px_34px_rgba(0,0,0,0.5)]">
            <button
              type="button"
              onClick={clear}
              aria-label="Cancelar seleção"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-4" />
            </button>
            <span className="text-[13.5px] text-foreground/90">
              {count} {count === 1 ? "selecionada" : "selecionadas"}
            </span>

            {count < visibleIds.length && (
              <Button variant="ghost" size="sm" leftIcon={<CheckCheck />} onClick={selectAll}>
                Selecionar todas
              </Button>
            )}

            <div className="ml-auto flex items-center gap-2">
            {status === "active" && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Archive />}
                onClick={() => {
                  bulkArchive(selectedIds);
                  clear();
                }}
              >
                Arquivar
              </Button>
            )}
            {status !== "active" && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<RotateCcw />}
                onClick={() => {
                  bulkRestore(selectedIds);
                  clear();
                }}
              >
                Restaurar
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Tags />}
              onClick={() => setTagPickerOpen(true)}
            >
              Aplicar tags
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 />}
              onClick={() => setConfirmOpen(true)}
            >
              {isTrashed ? "Excluir definitivamente" : "Excluir"}
            </Button>
            </div>
          </div>

          <TagPickerVault open={tagPickerOpen} onOpenChange={setTagPickerOpen} noteIds={selectedIds} />

          <ConfirmVault
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={isTrashed ? "Excluir definitivamente?" : "Excluir selecionadas?"}
            description={
              isTrashed
                ? `${count} ${count === 1 ? "item será removido" : "itens serão removidos"} para sempre. Essa ação não pode ser desfeita.`
                : `${count} ${count === 1 ? "item vai" : "itens vão"} para a lixeira e podem ser restaurados depois.`
            }
            confirmLabel={isTrashed ? "Excluir definitivamente" : "Excluir"}
            onConfirm={handleDelete}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
