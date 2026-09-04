"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck, Tags, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { useJwlibrarySelectionStore } from "@/lib/store/jwlibrary-selection-store";
import { bulkDeleteJwlibraryNotes } from "@/app/(app)/jwlibrary-actions";
import { JwlibraryTagPickerVault } from "./jwlibrary-tag-picker-vault";

interface JwlibraryBulkActionBarProps {
  onDeleted: () => void;
}

/** Mirrors components/content/bulk-action-bar.tsx, simplified — jwlibrary notes have no archive/trash states, just tag and delete. */
export function JwlibraryBulkActionBar({ onDeleted }: JwlibraryBulkActionBarProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const selectedIds = useJwlibrarySelectionStore((s) => s.selectedIds);
  const visibleIds = useJwlibrarySelectionStore((s) => s.visibleIds);
  const selectAll = useJwlibrarySelectionStore((s) => s.selectAll);
  const clear = useJwlibrarySelectionStore((s) => s.clear);

  const count = selectedIds.length;

  async function handleDelete() {
    await bulkDeleteJwlibraryNotes(selectedIds);
    clear();
    onDeleted();
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
              <Button variant="ghost" size="sm" leftIcon={<Tags />} onClick={() => setTagPickerOpen(true)}>
                Aplicar tags
              </Button>
              <Button variant="ghost" size="sm" leftIcon={<Trash2 />} onClick={() => setConfirmOpen(true)}>
                Excluir
              </Button>
            </div>
          </div>

          <JwlibraryTagPickerVault open={tagPickerOpen} onOpenChange={setTagPickerOpen} noteIds={selectedIds} />

          <ConfirmVault
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Excluir notas selecionadas?"
            description={`${count} ${count === 1 ? "nota será removida" : "notas serão removidas"} para sempre. Essa ação não pode ser desfeita.`}
            confirmLabel="Excluir"
            onConfirm={() => void handleDelete()}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
