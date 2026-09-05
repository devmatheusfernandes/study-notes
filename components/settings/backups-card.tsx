"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, BookMarked, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { useNotesStore } from "@/lib/store/notes-store";
import { useFileUpload } from "@/hooks/use-file-upload";
import { ProcessingShimmer, UploadWaveProgress } from "@/components/content/upload-progress-indicators";

/**
 * Imported .jwlibrary backups aren't notes/files a user browses on /notes —
 * they're a collection of many notes/highlights managed on their own
 * /jwlibrary screen (see components/content/notes-collection.tsx, which
 * excludes type "jwlibrary" from its grid). This card is where the backup
 * *files themselves* (one per upload) get imported, listed, and deleted.
 */
export function BackupsCard() {
  const backups = useNotesStore((s) => s.notes).filter((n) => n.type === "jwlibrary");
  const deletePermanently = useNotesStore((s) => s.deletePermanently);
  const fileInput = useRef<HTMLInputElement>(null);
  const { upload, isUploading } = useFileUpload();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    void upload(Array.from(list));
    if (fileInput.current) fileInput.current.value = "";
  }

  const deletingBackup = backups.find((b) => b.id === confirmDeleteId);

  return (
    <section className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <BookMarked className="size-5" />
          </span>
          <div className="flex flex-col">
            <h3 className="font-heading text-base text-foreground">Backups do JW Library</h3>
            <p className="text-[12.5px] text-muted-foreground">
              Arquivos .jwlibrary importados — notas, marcações e tags ficam em Estudo Pessoal.
            </p>
          </div>
        </div>

        <input ref={fileInput} type="file" accept=".jwlibrary" hidden onChange={(e) => handleFiles(e.target.files)} />
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Upload />}
          isLoading={isUploading}
          onClick={() => fileInput.current?.click()}
          className="rounded-full text-[12.5px]"
        >
          Importar backup
        </Button>
      </div>

      {backups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-8 text-center">
          <BookMarked className="size-5 text-muted-foreground" />
          <p className="text-[12.5px] text-muted-foreground">Nenhum backup importado ainda.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <AnimatePresence mode="popLayout">
            {backups.map((backup) => {
              const isOptimistic = backup.id.startsWith("optimistic:");
              const isUploadingThis = backup.processing && isOptimistic;
              const isProcessing = backup.processing && !isOptimistic;
              return (
                <motion.div
                  key={backup.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="relative flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-2xl border border-border/50 bg-secondary/30 p-3.5"
                >
                  {isUploadingThis && <UploadWaveProgress progress={backup.uploadProgress ?? 0} />}
                  {isProcessing && <ProcessingShimmer />}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13.5px] font-medium text-foreground">{backup.title}</span>
                    <span className="text-[11.5px] text-muted-foreground">
                      {isUploadingThis ? "Enviando…" : isProcessing ? "Processando…" : backup.meta}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!backup.processing}
                      leftIcon={<ArrowUpRight />}
                      render={<Link href="/jwlibrary" />}
                    >
                      Ver
                    </Button>
                    <button
                      type="button"
                      disabled={!!backup.processing}
                      onClick={() => setConfirmDeleteId(backup.id)}
                      aria-label={`Excluir backup ${backup.title}`}
                      className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <ConfirmVault
        open={confirmDeleteId !== null}
        onOpenChange={(next) => !next && setConfirmDeleteId(null)}
        title="Excluir este backup?"
        description={
          deletingBackup
            ? `As notas, marcações e tags importadas de "${deletingBackup.title}" serão removidas para sempre. Essa ação não pode ser desfeita.`
            : undefined
        }
        confirmLabel="Excluir"
        onConfirm={() => {
          if (confirmDeleteId) deletePermanently(confirmDeleteId);
        }}
      />
    </section>
  );
}
