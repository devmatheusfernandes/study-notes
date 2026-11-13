"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { Progress } from "@/components/ui/progress";
import { notify } from "@/components/ui/toaster";
import { Vault, VaultBody, VaultContent, VaultDescription, VaultHeader, VaultTitle } from "@/components/ui/vault";
import { useDeviceStore } from "@/hooks/ui/use-device";
import { cn } from "@/lib/utils";
import { useJwOutbox } from "@/lib/offline/jwlibrary-outbox";
import {
  OFFLINE_PUBLICATION_CHANGED_EVENT,
  downloadPublication,
  getOfflinePublication,
  removeOfflinePublication,
  type OfflinePublication,
} from "@/lib/offline/jwpub-offline";
import { isOfflineStorageAvailable } from "@/lib/offline/idb";
import type { ChapterSummary, PublicationSummary } from "@/lib/jwpub/types";

interface JwpubOfflineButtonProps {
  noteId: string;
  publication: PublicationSummary;
  chapters: ChapterSummary[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Header control for keeping a publication on this device. Opens a Vault with
 * the download state — never a dialog (see the "no modals" rule in CLAUDE.md).
 */
export function JwpubOfflineButton({ noteId, publication, chapters }: JwpubOfflineButtonProps) {
  const isOnline = useDeviceStore((s) => s.isOnline);
  // undefined: still reading IndexedDB. null: nothing downloaded.
  const [record, setRecord] = useState<OfflinePublication | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [progress, setProgress] = useState<{ fraction: number; label: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = () =>
      void getOfflinePublication(noteId).then((found) => {
        if (!cancelled) setRecord(found ?? null);
      });
    read();
    // The reader re-downloads in the background after a reprocess.
    window.addEventListener(OFFLINE_PUBLICATION_CHANGED_EVENT, read);
    return () => {
      cancelled = true;
      window.removeEventListener(OFFLINE_PUBLICATION_CHANGED_EVENT, read);
    };
  }, [noteId]);

  const supported = isOfflineStorageAvailable();
  const downloading = progress !== null;
  // A reprocessed publication gets a new id; the copy on the device is then of the old one.
  const upToDate = !!record && record.publication.id === publication.id;
  const stale = !!record && !upToDate;

  const download = useCallback(async () => {
    setProgress({ fraction: 0, label: "Preparando" });
    try {
      // Edits still waiting in the outbox have to reach the server first, or the snapshot would miss them.
      await useJwOutbox.getState().sync();
      if (useJwOutbox.getState().ops.length > 0) throw new Error("Há alterações ainda sem sincronizar. Tente de novo com conexão.");

      const saved = await downloadPublication(noteId, publication, chapters, (fraction, label) =>
        setProgress({ fraction, label })
      );
      setRecord(saved);
      notify.success(
        "Publicação baixada",
        saved.mediaFailed > 0 ? `${saved.mediaFailed} imagens não puderam ser baixadas.` : "Pronta para ler sem internet."
      );
    } catch (error) {
      notify.error(
        "Não foi possível baixar a publicação",
        error instanceof Error ? error.message : "Verifique sua conexão e tente de novo."
      );
    } finally {
      setProgress(null);
    }
  }, [noteId, publication, chapters]);

  async function remove() {
    await removeOfflinePublication(noteId);
    setRecord(null);
    notify.success("Download removido");
  }

  if (!supported) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={upToDate ? "Publicação disponível offline" : "Baixar para ler offline"}
        title={upToDate ? "Disponível offline" : "Baixar para ler offline"}
        className={cn(
          "shrink-0 rounded-full p-2 transition-colors",
          upToDate
            ? "text-success hover:bg-secondary"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        )}
      >
        {upToDate ? <CircleCheck className="size-4" /> : <Download className={cn("size-4", downloading && "animate-pulse")} />}
      </button>

      <Vault open={open} onOpenChange={setOpen}>
        <VaultContent aria-label="Leitura offline">
          <VaultHeader showCloseButton={false}>
            <VaultTitle>Leitura offline</VaultTitle>
            <VaultDescription>
              {upToDate
                ? "Esta publicação está salva neste aparelho. Destaques, notas e respostas feitos sem internet são enviados quando a conexão voltar."
                : stale
                  ? "A publicação foi reprocessada depois do último download. Baixe de novo para ler a versão atual sem internet."
                  : "Salve a publicação neste aparelho para lê-la, destacar e anotar sem internet."}
            </VaultDescription>
          </VaultHeader>

          <VaultBody>
            <div className="flex flex-col gap-4">
              {record && (
                <p className="text-center font-mono text-[11.5px] text-muted-foreground">
                  {formatBytes(record.bytes)} · baixada em {new Date(record.downloadedAt).toLocaleDateString("pt-BR")}
                </p>
              )}

              {downloading && progress && (
                <div className="flex flex-col gap-1.5">
                  <Progress value={Math.round(progress.fraction * 100)} />
                  <span className="text-center text-[12px] text-muted-foreground">{progress.label}…</span>
                </div>
              )}

              {!isOnline && !upToDate && (
                <p className="text-center text-[12.5px] text-muted-foreground">Conecte-se à internet para baixar.</p>
              )}

              <div className="flex flex-col gap-2">
                {!upToDate && (
                  <Button
                    leftIcon={<Download />}
                    fullWidth
                    isLoading={downloading}
                    disabled={!isOnline || downloading}
                    onClick={() => void download()}
                  >
                    {stale ? "Baixar de novo" : "Baixar publicação"}
                  </Button>
                )}
                {upToDate && (
                  <Button variant="outline" fullWidth isLoading={downloading} disabled={!isOnline || downloading} onClick={() => void download()}>
                    Atualizar download
                  </Button>
                )}
                {record && (
                  <Button variant="ghost" fullWidth disabled={downloading} onClick={() => setConfirmRemove(true)}>
                    Remover do aparelho
                  </Button>
                )}
              </div>
            </div>
          </VaultBody>
        </VaultContent>
      </Vault>

      <ConfirmVault
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remover download?"
        description="A publicação continua na sua biblioteca, mas só abrirá com internet. Seus destaques e notas não são apagados."
        confirmLabel="Remover"
        onConfirm={() => void remove()}
      />
    </>
  );
}
